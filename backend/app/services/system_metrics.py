"""Operational metrics for the judge-facing console.

The rule that governs this module is the same one that governs the Integrity
Check: every figure is read from PostgreSQL at the moment it is asked for. There
is no cache, no counter incremented in application memory, and no derived
estimate presented as a measurement. The single exception is request latency,
which is per-replica process memory and is labelled as such in the response and
on the card that renders it (see observability.py).

Why these numbers and not others: each one answers a question a sceptical
reviewer asks about a money system under load.

  "Are transactions actually committing?" -> commit ratio, and what the
                                             rollbacks actually are
  "Did the lock ordering hold?"           -> deadlocks, queries blocked on locks
  "Is the database the bottleneck?"       -> cache hit ratio, connections in use
  "How much did it actually carry?"       -> transfers per minute, measured
  "What did concurrency control refuse?"  -> the audit-derived counters
"""

import time

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..db import engine
from ..observability import snapshot as latency_snapshot
from ..observability import thread_limit

# Audit event types the concurrency card reports. Each is written inside the
# transaction whose outcome it describes, so these are a record of what the
# money path decided -- not a tally a process kept and could lose on restart.
CONCURRENCY_EVENTS = {
    "IDEMPOTENT_REPLAY": "idempotentReplays",
    "INSUFFICIENT_FUNDS": "rejectedOverspends",
    "STEP_UP_REQUIRED": "stepUpsTriggered",
    "TRANSFER_REJECTED": "policyRejections",
    "TRANSFER_COMPLETED": "transfersCompleted",
}

_DATABASE_SQL = """
SELECT
    d.xact_commit,
    d.xact_rollback,
    d.deadlocks,
    d.blks_read,
    d.blks_hit,
    d.temp_files,
    d.numbackends,
    pg_database_size(current_database())    AS database_size_bytes,
    current_setting('max_connections')::int AS max_connections,
    (SELECT count(*) FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'active')       AS active_connections,
    (SELECT count(*) FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock')                                AS blocked_on_locks,
    (SELECT COALESCE(EXTRACT(EPOCH FROM max(now() - xact_start)), 0)
       FROM pg_stat_activity
      WHERE datname = current_database() AND xact_start IS NOT NULL) AS longest_txn_seconds
FROM pg_stat_database d
WHERE d.datname = current_database()
"""

# Gap-filled so the sparkline has a point for every minute, including the idle
# ones. Without the generate_series a quiet minute would simply be absent and
# the line would imply continuous traffic that did not happen.
_PER_MINUTE_SQL = """
SELECT g.minute,
       COALESCE(t.transfers, 0)    AS transfers,
       COALESCE(t.total_poisha, 0) AS total_poisha
FROM generate_series(
        date_trunc('minute', now()) - interval '59 minutes',
        date_trunc('minute', now()),
        interval '1 minute'
     ) AS g(minute)
LEFT JOIN (
    SELECT date_trunc('minute', created_at)  AS minute,
           count(*)                          AS transfers,
           COALESCE(sum(total_poisha), 0)    AS total_poisha
    FROM transfers
    WHERE created_at >= date_trunc('minute', now()) - interval '59 minutes'
      AND kind IN ('P2P', 'GROUP', 'REVERSAL')
    GROUP BY 1
) AS t ON t.minute = g.minute
ORDER BY g.minute
"""

_WINDOWS_SQL = """
SELECT
    count(*) FILTER (WHERE created_at >= now() - interval '60 seconds') AS last_60s,
    count(*) FILTER (WHERE created_at >= now() - interval '15 minutes') AS last_15m,
    count(*) FILTER (WHERE created_at >= now() - interval '60 minutes') AS last_60m
FROM transfers
WHERE kind IN ('P2P', 'GROUP', 'REVERSAL')
  AND created_at >= now() - interval '60 minutes'
"""

_EVENTS_SQL = """
SELECT event_type,
       count(*)                                                            AS total,
       count(*) FILTER (WHERE created_at >= now() - interval '60 minutes') AS last_hour
FROM audit_events
WHERE event_type = ANY(:types)
GROUP BY event_type
"""

_RETENTION_SQL = """
SELECT
    (SELECT count(*) FROM idempotency_records) AS idempotency_records,
    (SELECT count(*) FROM audit_events)        AS audit_events,
    (SELECT count(*) FROM rate_limit_counters) AS rate_limit_counters,
    (SELECT count(*) FROM journal_entries)     AS journal_entries
"""


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(100.0 * numerator / denominator, 3)


def run(session: Session) -> dict:
    started = time.perf_counter()

    db = session.execute(text(_DATABASE_SQL)).one()
    per_minute = session.execute(text(_PER_MINUTE_SQL)).all()
    windows = session.execute(text(_WINDOWS_SQL)).one()
    retention = session.execute(text(_RETENTION_SQL)).one()

    events = {
        row.event_type: {"total": int(row.total), "lastHour": int(row.last_hour)}
        for row in session.execute(text(_EVENTS_SQL), {"types": list(CONCURRENCY_EVENTS)}).all()
    }
    concurrency = {
        name: events.get(event_type, {"total": 0, "lastHour": 0})
        for event_type, name in CONCURRENCY_EVENTS.items()
    }

    series = [
        {
            "minute": row.minute.isoformat(),
            "transfers": int(row.transfers),
            "totalPoisha": int(row.total_poisha),
        }
        for row in per_minute
    ]
    peak = max((point["transfers"] for point in series), default=0)

    pool = engine.pool
    return {
        "instance": settings.instance_id,
        "database": {
            "commits": int(db.xact_commit),
            "rollbacks": int(db.xact_rollback),
            # A rollback here is almost always a deliberate refusal -- an
            # overspend blocked inside the lock, or a duplicate Idempotency-Key
            # losing its unique-violation race. The ratio is context, not a
            # grade, and the concurrency counters say which is which.
            "commitRatioPercent": _ratio(
                int(db.xact_commit), int(db.xact_commit) + int(db.xact_rollback)
            ),
            "deadlocks": int(db.deadlocks),
            "blockedOnLocks": int(db.blocked_on_locks),
            "longestTransactionSeconds": round(float(db.longest_txn_seconds), 2),
            "cacheHitPercent": _ratio(int(db.blks_hit), int(db.blks_hit) + int(db.blks_read)),
            "tempFiles": int(db.temp_files),
            "activeConnections": int(db.active_connections),
            "openConnections": int(db.numbackends),
            "maxConnections": int(db.max_connections),
            "databaseSizeBytes": int(db.database_size_bytes),
        },
        "throughput": {
            "transfersLast60s": int(windows.last_60s or 0),
            "transfersLast15m": int(windows.last_15m or 0),
            "transfersLast60m": int(windows.last_60m or 0),
            "peakTransfersPerMinute": peak,
            "perMinute": series,
        },
        "concurrency": concurrency,
        "retention": {
            "idempotencyRecords": int(retention.idempotency_records),
            "auditEvents": int(retention.audit_events),
            "rateLimitCounters": int(retention.rate_limit_counters),
            "journalEntries": int(retention.journal_entries),
        },
        # Per-replica, from process memory. Named so nobody reads it as a
        # system-wide figure.
        "latency": latency_snapshot(),
        # Also per-replica. Reported as "in use out of capacity" rather than as
        # SQLAlchemy's raw overflow counter, which starts at negative pool_size
        # and reads as a fault to anyone who has not seen it before.
        "pool": {
            "instance": settings.instance_id,
            "inUse": pool.checkedout(),
            "capacity": settings.db_pool_size + settings.db_max_overflow,
            "poolSize": settings.db_pool_size,
            "maxOverflow": settings.db_max_overflow,
            "overflowInUse": max(0, pool.overflow()),
            "utilizationPercent": _ratio(
                pool.checkedout(), settings.db_pool_size + settings.db_max_overflow
            ),
            "checkoutTimeoutSeconds": settings.db_pool_timeout_seconds,
            # Captured from the live limiter at startup, not copied from
            # settings, so it reports what the process actually enforces. Sync
            # endpoints run on these threads and each can hold two connections,
            # so this number doubled must stay within the capacity above.
            "requestThreads": thread_limit(),
        },
        "computedInMs": round((time.perf_counter() - started) * 1000, 2),
    }
