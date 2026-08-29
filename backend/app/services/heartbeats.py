"""Cross-replica liveness recorded in the shared financial database."""

from sqlalchemy import text

from ..config import settings
from ..db import SessionLocal


def beat() -> None:
    with SessionLocal() as session:
        session.execute(
            text(
                """
                INSERT INTO replica_heartbeats (instance_id, started_at, last_seen_at)
                VALUES (:instance, now(), now())
                ON CONFLICT (instance_id)
                DO UPDATE SET last_seen_at = excluded.last_seen_at
                """
            ),
            {"instance": settings.instance_id},
        )
        session.commit()
