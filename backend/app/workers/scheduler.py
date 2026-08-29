import time

from sqlalchemy.exc import SQLAlchemyError

from ..db import SessionLocal, apply_schema
from ..services.retention import sweep
from ..services.scheduled_transfers import execute_next_due

# Retention is housekeeping, not money movement. It runs on the scheduler because
# this is the one process that is already awake with nothing latency-sensitive to
# do, and it runs rarely because each pass is bounded and the backlog it collects
# is measured in hours.
RETENTION_INTERVAL_SECONDS = 300


def run() -> None:
    apply_schema()
    next_sweep = time.monotonic()

    while True:
        found = False
        try:
            with SessionLocal() as session:
                result = execute_next_due(session)
                found = result is not None
                session.commit()
        except SQLAlchemyError as exc:
            print(f"scheduler database error: {type(exc).__name__}", flush=True)
        except Exception as exc:
            print(f"scheduler error: {type(exc).__name__}", flush=True)

        if time.monotonic() >= next_sweep:
            next_sweep = time.monotonic() + RETENTION_INTERVAL_SECONDS
            try:
                with SessionLocal() as session:
                    removed = sweep(session)
                    session.commit()
                if any(removed.values()):
                    print(f"retention sweep removed {removed}", flush=True)
            except SQLAlchemyError as exc:
                # A failed sweep is a deferred sweep. Due Scheduled Transfers are
                # the job that matters here and must not stop for housekeeping.
                print(f"retention sweep database error: {type(exc).__name__}", flush=True)

        time.sleep(0.2 if found else 2.0)


if __name__ == "__main__":
    run()
