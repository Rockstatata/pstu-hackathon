import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..errors import DomainError


def create(
    session: Session,
    *,
    user_id: uuid.UUID,
    kind: str,
    title: str,
    message: str,
    resource_type: str | None = None,
    resource_id: uuid.UUID | None = None,
) -> uuid.UUID:
    notification_id = uuid.uuid4()
    session.execute(
        text(
            "INSERT INTO notifications "
            "(id, user_id, kind, title, message, resource_type, resource_id) "
            "VALUES (:id, :uid, :kind, :title, :message, :rtype, :rid)"
        ),
        {
            "id": notification_id,
            "uid": user_id,
            "kind": kind,
            "title": title,
            "message": message,
            "rtype": resource_type,
            "rid": resource_id,
        },
    )
    return notification_id


def list_for_user(
    session: Session, *, user_id: uuid.UUID, limit: int, unread_only: bool
) -> dict:
    unread_clause = "AND read_at IS NULL" if unread_only else ""
    rows = session.execute(
        text(
            "SELECT id, kind, title, message, resource_type, resource_id, read_at, created_at "
            "FROM notifications WHERE user_id = :uid "
            + unread_clause
            + " ORDER BY created_at DESC, id DESC LIMIT :limit"
        ),
        {"uid": user_id, "limit": limit},
    ).all()
    unread_count = session.execute(
        text("SELECT COUNT(*) FROM notifications WHERE user_id = :uid AND read_at IS NULL"),
        {"uid": user_id},
    ).scalar_one()
    return {
        "notifications": [
            {
                "notificationId": str(row.id),
                "kind": row.kind,
                "title": row.title,
                "message": row.message,
                "resourceType": row.resource_type,
                "resourceId": str(row.resource_id) if row.resource_id else None,
                "readAt": row.read_at.isoformat() if row.read_at else None,
                "createdAt": row.created_at.isoformat(),
            }
            for row in rows
        ],
        "unreadCount": unread_count,
    }


def mark_read(session: Session, *, user_id: uuid.UUID, notification_id: uuid.UUID) -> dict:
    row = session.execute(
        text(
            "UPDATE notifications SET read_at = COALESCE(read_at, now()) "
            "WHERE id = :id AND user_id = :uid RETURNING id"
        ),
        {"id": notification_id, "uid": user_id},
    ).one_or_none()
    if row is None:
        raise DomainError("NOTIFICATION_NOT_FOUND", "No notification found with that ID.", 404)
    return list_for_user(session, user_id=user_id, limit=50, unread_only=False)


def mark_all_read(session: Session, *, user_id: uuid.UUID) -> dict:
    session.execute(
        text(
            "UPDATE notifications SET read_at = now() "
            "WHERE user_id = :uid AND read_at IS NULL"
        ),
        {"uid": user_id},
    )
    return list_for_user(session, user_id=user_id, limit=50, unread_only=False)
