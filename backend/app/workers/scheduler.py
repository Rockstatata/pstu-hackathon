import time

from sqlalchemy.exc import SQLAlchemyError

from ..db import SessionLocal, apply_schema
from ..services.scheduled_transfers import execute_next_due


def run() -> None:
    apply_schema()
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
        time.sleep(0.2 if found else 2.0)


if __name__ == "__main__":
    run()
