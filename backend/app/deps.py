import uuid
from dataclasses import dataclass

from fastapi import Depends, Header, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import get_session
from .errors import unauthenticated
from .security import decode_token


@dataclass(frozen=True)
class CurrentUser:
    """The sender is resolved from the token, never from the request body.

    A client that names its own sender_id can send another person's money, so the
    body has no place to name one.
    """

    user_id: uuid.UUID
    account_id: uuid.UUID
    name: str
    phone: str
    pin_hash: str


def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthenticated()

    user_id = decode_token(authorization.split(" ", 1)[1].strip())
    if user_id is None:
        raise unauthenticated("Your session has expired. Sign in again.")

    row = session.execute(
        text(
            "SELECT u.id, u.name, u.phone, u.pin_hash, a.id AS account_id "
            "FROM users u JOIN accounts a ON a.user_id = u.id "
            "WHERE u.id = :uid AND u.is_system = FALSE"
        ),
        {"uid": user_id},
    ).one_or_none()

    if row is None:
        raise unauthenticated()

    current = CurrentUser(
        user_id=row.id,
        account_id=row.account_id,
        name=row.name,
        phone=row.phone,
        pin_hash=row.pin_hash,
    )
    request.state.authenticated_user_id = str(current.user_id)
    return current
