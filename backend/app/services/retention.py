"""Bounded retention sweeps for the two tables that grow without ever being read again.

Two tables accumulate rows that stop being meaningful after a fixed period, and
neither had anything that removed them. On a hackathon timescale that is
invisible; on any real one it is the slow leak that eventually makes the money
path share its disk and buffer cache with dead weight.

What is deliberately NOT swept:

  audit_events    The Integrity Check's counters and the sign-in lockout are both
                  computed from it. Deleting a row here would silently change a
                  number the operations console presents as all-time truth, and
                  would hand an attacker back the login attempts they already
                  spent. It grows, and that is the correct trade.

  journal_entries The Ledger. Never.

Each sweep is capped so it can never take a long lock on a table the money path
also touches. If a cap is reached the remainder is simply collected on the next
pass, which is why the caller runs this on a timer rather than to completion.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

BATCH = 5000

# Fixed one-minute windows. Anything older than an hour cannot influence a
# current allowance, so it is unreachable rather than merely stale.
RATE_LIMIT_RETENTION = "1 hour"

# Well beyond any legitimate client retry, and beyond the 24-hour Money Request
# TTL. Purging sooner would let a late duplicate re-execute as a fresh request,
# which is the exact failure the records exist to prevent.
IDEMPOTENCY_RETENTION = "48 hours"

_SWEEPS = (
    (
        "rate_limit_counters",
        """
        DELETE FROM rate_limit_counters
        WHERE ctid IN (
            SELECT ctid FROM rate_limit_counters
            WHERE window_started_at < now() - CAST(:retention AS interval)
            LIMIT :batch
        )
        """,
        RATE_LIMIT_RETENTION,
    ),
    (
        "idempotency_records",
        """
        DELETE FROM idempotency_records
        WHERE ctid IN (
            SELECT ctid FROM idempotency_records
            WHERE created_at < now() - CAST(:retention AS interval)
            LIMIT :batch
        )
        """,
        IDEMPOTENCY_RETENTION,
    ),
)


def sweep(session: Session) -> dict[str, int]:
    """Delete one bounded batch from each swept table. Returns rows removed by table."""
    removed: dict[str, int] = {}
    for table, sql, retention in _SWEEPS:
        # The window is a bound parameter cast to an interval, not interpolated
        # SQL. These are module constants today; a retention window that becomes
        # configurable later must not become an injection point.
        result = session.execute(text(sql), {"retention": retention, "batch": BATCH})
        removed[table] = result.rowcount or 0
    return removed
