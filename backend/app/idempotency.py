"""Exactly-once business effect.

The guard is not a check-then-act -- those race. It is a UNIQUE(user_id, key)
constraint written INSIDE the money transaction. Two concurrent requests with the
same key: the first inserts and holds the row until commit, the second blocks on
that uniqueness check, then loses with a unique violation and replays the winner's
stored response. There is no window in which both proceed.
"""

import hashlib
import json
import uuid

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .errors import DomainError


class ReplayResult(Exception):
    """Not an error -- control flow. Carries the original response to return verbatim."""

    def __init__(self, status_code: int, body: dict):
        super().__init__("idempotent replay")
        self.status_code = status_code
        self.body = body


def hash_request(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def require_key(key: str | None) -> str:
    if not key or not key.strip():
        raise DomainError(
            "IDEMPOTENCY_KEY_REQUIRED",
            "This request needs an Idempotency-Key header.",
            400,
        )
    if len(key) > 80:
        raise DomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is too long.", 400)
    return key.strip()


def _replay_or_conflict(row, request_hash: str) -> None:
    if row.request_hash != request_hash:
        raise DomainError(
            "IDEMPOTENCY_KEY_REUSED",
            "That Idempotency-Key was already used for a different request.",
            409,
        )
    if row.response_body is None:
        # The winning request holds the row but has not committed a response.
        # We block on its row lock in the normal path, so reaching here means it
        # committed the reservation and then died. Do not guess at the outcome.
        raise DomainError(
            "REQUEST_IN_PROGRESS",
            "That request is still being processed. Check your history before retrying.",
            409,
        )
    raise ReplayResult(row.status_code or 200, row.response_body)


def peek(session: Session, user_id: uuid.UUID, key: str, request_hash: str) -> None:
    """Cheap pre-transaction read. Raises ReplayResult on a hit.

    This is an optimisation for the common storm case, not the guard. Missing it
    is harmless -- reserve() below is what actually enforces exactly-once.
    """
    row = session.execute(
        text(
            "SELECT request_hash, status_code, response_body FROM idempotency_records "
            "WHERE user_id = :uid AND idempotency_key = :key"
        ),
        {"uid": user_id, "key": key},
    ).one_or_none()
    if row is not None:
        _replay_or_conflict(row, request_hash)


def reserve(
    session: Session, user_id: uuid.UUID, key: str, request_hash: str, resource_type: str
) -> uuid.UUID:
    """Claim the key inside the caller's open transaction. Raises ReplayResult if lost.

    On unique violation the caller's transaction is poisoned, so we roll back and
    re-read on a fresh transaction -- by then the winner has committed its response.
    """
    record_id = uuid.uuid4()
    try:
        with session.begin_nested():
            session.execute(
                text(
                    "INSERT INTO idempotency_records "
                    "(id, user_id, idempotency_key, request_hash, resource_type) "
                    "VALUES (:id, :uid, :key, :hash, :rtype)"
                ),
                {
                    "id": record_id,
                    "uid": user_id,
                    "key": key,
                    "hash": request_hash,
                    "rtype": resource_type,
                },
            )
        return record_id
    except IntegrityError:
        session.rollback()
        row = session.execute(
            text(
                "SELECT request_hash, status_code, response_body FROM idempotency_records "
                "WHERE user_id = :uid AND idempotency_key = :key"
            ),
            {"uid": user_id, "key": key},
        ).one_or_none()
        if row is None:
            raise DomainError(
                "INTERNAL_ERROR", "Could not complete that request. Please try again.", 500
            )
        _replay_or_conflict(row, request_hash)
        raise  # unreachable; _replay_or_conflict always raises


def finalize(
    session: Session,
    record_id: uuid.UUID,
    resource_id: uuid.UUID,
    status_code: int,
    body: dict,
) -> None:
    """Store the response in the SAME transaction as the journal entries.

    If this did not commit atomically with the money, a crash between the two would
    leave a key that replays a response describing a transfer that never happened.
    """
    session.execute(
        text(
            "UPDATE idempotency_records SET resource_id = :rid, status_code = :sc, "
            "response_body = CAST(:body AS jsonb) WHERE id = :id"
        ),
        {
            "id": record_id,
            "rid": resource_id,
            "sc": status_code,
            "body": json.dumps(body, default=str),
        },
    )
