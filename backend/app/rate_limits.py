"""PostgreSQL-backed fixed-window rate limits shared by every API replica."""

import hashlib

from sqlalchemy import text

from .db import SessionLocal
from .errors import DomainError


def consume(scope: str, subject: str, limit: int) -> None:
    digest = hashlib.sha256(subject.encode("utf-8")).hexdigest()
    with SessionLocal() as session:
        row = session.execute(
            text(
                """
                INSERT INTO rate_limit_counters
                    (scope, subject_hash, window_started_at, request_count)
                VALUES (:scope, :subject, date_trunc('minute', now()), 1)
                ON CONFLICT (scope, subject_hash, window_started_at)
                DO UPDATE SET request_count = rate_limit_counters.request_count + 1
                RETURNING request_count,
                    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
                        window_started_at + interval '1 minute' - now()
                    )))::integer) AS retry_after
                """
            ),
            {"scope": scope, "subject": digest},
        ).one()
        session.commit()

    if row.request_count > limit:
        raise DomainError(
            "RATE_LIMITED",
            "Too many requests. Wait a moment and try again.",
            429,
            headers={"Retry-After": str(row.retry_after)},
            retryAfterSeconds=row.retry_after,
        )
