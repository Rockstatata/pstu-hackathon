import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import CurrentUser, current_user
from ..errors import DomainError
from ..services import notifications

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    limit: int = Query(default=50, ge=1, le=100),
    unread_only: bool = Query(default=False, alias="unreadOnly"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return notifications.list_for_user(
        session, user_id=user.user_id, limit=limit, unread_only=unread_only
    )


@router.post("/read-all")
def read_all(
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    try:
        result = notifications.mark_all_read(session, user_id=user.user_id)
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


@router.post("/{notification_id}/read")
def read_one(
    notification_id: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    try:
        parsed_id = uuid.UUID(notification_id)
    except ValueError as exc:
        raise DomainError("NOTIFICATION_NOT_FOUND", "No notification found with that ID.", 404) from exc
    try:
        result = notifications.mark_read(
            session, user_id=user.user_id, notification_id=parsed_id
        )
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise
