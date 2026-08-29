"""Snapshot what the database itself says, either side of a load scenario.

The k6 summaries record what the client saw. This records what PostgreSQL saw,
and the two are not the same claim: a client can be told a transfer committed by
a process that then died before COMMIT, and only the database can settle it.

Everything here is read from `pg_stat_database`, the Integrity Check and plain
row counts. Nothing is computed by this script beyond subtracting one snapshot
from another, so a reader can re-run the same queries by hand and get the same
numbers.

Usage:
    python tests/bench/collect.py snapshot <label>   # write one snapshot
    python tests/bench/collect.py delta <before> <after>
"""

import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

RESULTS = pathlib.Path(__file__).parent / "results"
SNAPSHOTS = RESULTS / "snapshots"
BASE_URL = "http://localhost:8080/api/v1"
DB_CONTAINER = "pstu-money-db-1"
DB_USER = "money"
DB_NAME = "money"

# One row, one JSON object, so the shape of the snapshot lives in SQL where a
# reviewer can read it rather than being assembled across Python statements.
STATS_SQL = """
SELECT row_to_json(s) FROM (
    SELECT
        d.xact_commit,
        d.xact_rollback,
        d.deadlocks,
        d.blks_read,
        d.blks_hit,
        d.temp_files,
        d.tup_inserted,
        d.tup_updated,
        pg_database_size(current_database())            AS database_size_bytes,
        (SELECT count(*) FROM transfers)                AS transfers,
        (SELECT count(*) FROM journal_entries)          AS journal_entries,
        (SELECT count(*) FROM users WHERE NOT is_system) AS users,
        (SELECT count(*) FROM idempotency_records)      AS idempotency_records,
        (SELECT count(*) FROM audit_events)             AS audit_events
    FROM pg_stat_database d
    WHERE d.datname = current_database()
) s
"""


def read_database() -> dict:
    result = subprocess.run(
        ["docker", "exec", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-tAc", STATS_SQL],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout.strip())


def read_endpoint(path: str) -> dict | None:
    """A missing endpoint is recorded as absent, never as a plausible default."""
    try:
        with urllib.request.urlopen(BASE_URL + path, timeout=10) as response:
            return json.loads(response.read().decode())
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        return {"unavailable": type(exc).__name__}


def snapshot(label: str) -> pathlib.Path:
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    payload = {
        "label": label,
        "takenAt": datetime.now(timezone.utc).isoformat(),
        "database": read_database(),
        "integrity": read_endpoint("/integrity"),
        "systemInfo": read_endpoint("/system-info"),
        "systemMetrics": read_endpoint("/system-metrics"),
    }
    path = SNAPSHOTS / f"{label}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


# Counters that only ever grow, so before-and-after subtraction is meaningful.
# Sizes and row counts are reported as levels instead, because subtracting them
# would describe growth, not activity.
CUMULATIVE = (
    "xact_commit",
    "xact_rollback",
    "deadlocks",
    "blks_read",
    "blks_hit",
    "temp_files",
    "tup_inserted",
    "tup_updated",
    "transfers",
    "journal_entries",
    "users",
    "idempotency_records",
    "audit_events",
)


def delta(before: dict, after: dict) -> dict:
    a, b = before["database"], after["database"]
    moved = {key: int(b[key]) - int(a[key]) for key in CUMULATIVE}

    commits, rollbacks = moved["xact_commit"], moved["xact_rollback"]
    total = commits + rollbacks
    return {
        "window": {"from": before["takenAt"], "to": after["takenAt"]},
        "transactions": {
            "committed": commits,
            "rolledBack": rollbacks,
            "commitRatioPercent": round(100.0 * commits / total, 3) if total else None,
        },
        # The number ADR-0003 stands or falls on.
        "deadlocks": moved["deadlocks"],
        "tempFiles": moved["temp_files"],
        "bufferCacheHitPercent": (
            round(
                100.0
                * moved["blks_hit"]
                / (moved["blks_hit"] + moved["blks_read"]),
                3,
            )
            if (moved["blks_hit"] + moved["blks_read"]) > 0
            else None
        ),
        "rowsWritten": {
            "transfers": moved["transfers"],
            "journalEntries": moved["journal_entries"],
            "usersRegistered": moved["users"],
            "idempotencyRecords": moved["idempotency_records"],
            "auditEvents": moved["audit_events"],
        },
        "integrityBefore": (before.get("integrity") or {}).get("verdict"),
        "integrityAfter": (after.get("integrity") or {}).get("verdict"),
        "ledgerDifferencePoishaAfter": (
            (after.get("integrity") or {}).get("totals", {}).get("differencePoisha")
        ),
    }


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "snapshot":
        path = snapshot(argv[2])
        print(f"wrote {path}")
        return 0

    if len(argv) == 4 and argv[1] == "delta":
        before = json.loads((SNAPSHOTS / f"{argv[2]}.json").read_text(encoding="utf-8"))
        after = json.loads((SNAPSHOTS / f"{argv[3]}.json").read_text(encoding="utf-8"))
        print(json.dumps(delta(before, after), indent=2))
        return 0

    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
