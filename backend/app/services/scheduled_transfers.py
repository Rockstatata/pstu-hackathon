"""Future transfer instructions with an explicit, non-ledger lifecycle."""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import idempotency as idem, policy
from ..db import set_lock_timeout
from ..errors import DomainError
from ..money import format_taka
from ..security import verify_pin
from . import ledger, notifications, transfer

_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_reference() -> str:
    return "SCH" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(11))


def _resource(row) -> dict:
    return {
        "scheduledTransferId": str(row.id),
        "reference": row.public_reference,
        "status": row.status,
        "amountPoisha": row.amount_poisha,
        "note": row.note,
        "executeAt": row.execute_at.isoformat(),
        "recipient": {
            "name": row.recipient_name,
            "maskedPhone": transfer.mask_phone(row.recipient_phone),
        },
        "transferReference": row.transfer_reference,
        "failureCode": row.failure_code,
        "failureMessage": row.failure_message,
        "authorizedAt": row.authorized_at.isoformat(),
        "resolvedAt": row.resolved_at.isoformat() if row.resolved_at else None,
        "createdAt": row.created_at.isoformat(),
    }


def _select_sql(where: str, *, lock: bool = False) -> str:
    return f"""
        SELECT st.id, st.public_reference, st.status, st.amount_poisha, st.note,
               st.execute_at, st.failure_code, st.failure_message,
               st.authorized_at, st.resolved_at, st.created_at,
               recipient.name AS recipient_name, recipient.phone AS recipient_phone,
               t.public_reference AS transfer_reference
        FROM scheduled_transfers st
        JOIN accounts recipient_account ON recipient_account.id = st.recipient_account_id
        JOIN users recipient ON recipient.id = recipient_account.user_id
        LEFT JOIN transfers t ON t.id = st.transfer_id
        WHERE {where}
        {"FOR UPDATE OF st" if lock else ""}
    """


def create(
    session: Session,
    *,
    creator_user_id: uuid.UUID,
    sender_account_id: uuid.UUID,
    sender_pin_hash: str,
    recipient_phone: str,
    amount_poisha: int,
    note: str | None,
    execute_at: datetime,
    pin: str | None,
    idempotency_key: str,
    request_hash: str,
) -> tuple[int, dict]:
    policy.check_amount(amount_poisha)
    now = datetime.now(timezone.utc)
    if execute_at <= now:
        raise DomainError("INVALID_SCHEDULE_TIME", "Choose a future date and time.")
    if execute_at > now + timedelta(days=365):
        raise DomainError(
            "INVALID_SCHEDULE_TIME", "Scheduled Transfers can be set up to one year ahead."
        )
    if not pin:
        raise DomainError(
            "STEP_UP_REQUIRED",
            "Confirm this future transfer instruction with your PIN.",
            403,
            stepUpReason="A Scheduled Transfer needs your PIN because it may execute later without you online.",
        )
    if not verify_pin(pin, sender_pin_hash):
        raise DomainError("STEP_UP_FAILED", "That PIN is not correct.", 403)

    set_lock_timeout(session)
    record_id = idem.reserve(
        session, creator_user_id, idempotency_key, request_hash, "scheduled_transfer"
    )
    resolved = transfer.resolve_recipients(
        session, [transfer.Recipient(phone=recipient_phone, amount_poisha=amount_poisha)]
    )[0]
    if resolved.account_id == sender_account_id:
        raise DomainError("SELF_TRANSFER_NOT_ALLOWED", "You cannot send money to yourself.")

    schedule_id = uuid.uuid4()
    reference = new_reference()
    session.execute(
        text(
            "INSERT INTO scheduled_transfers "
            "(id, public_reference, creator_user_id, sender_account_id, recipient_account_id, "
            "amount_poisha, note, execute_at) "
            "VALUES (:id, :ref, :uid, :sender, :recipient, :amount, :note, :execute_at)"
        ),
        {
            "id": schedule_id,
            "ref": reference,
            "uid": creator_user_id,
            "sender": sender_account_id,
            "recipient": resolved.account_id,
            "amount": amount_poisha,
            "note": note,
            "execute_at": execute_at,
        },
    )
    row = session.execute(
        text(_select_sql("st.id = :id")), {"id": schedule_id}
    ).one()
    body = _resource(row)
    ledger.audit(
        session,
        "SCHEDULED_TRANSFER_CREATED",
        actor_user_id=creator_user_id,
        resource_type="scheduled_transfer",
        resource_id=schedule_id,
        metadata={"reference": reference, "executeAt": execute_at.isoformat()},
    )
    idem.finalize(session, record_id, schedule_id, 201, body)
    return 201, body


def list_for_user(session: Session, *, user_id: uuid.UUID) -> dict:
    rows = session.execute(
        text(
            _select_sql("st.creator_user_id = :uid")
            + " ORDER BY st.execute_at DESC, st.id DESC LIMIT 100"
        ),
        {"uid": user_id},
    ).all()
    return {"scheduledTransfers": [_resource(row) for row in rows]}


def get(session: Session, *, schedule_id: uuid.UUID, user_id: uuid.UUID, lock: bool = False):
    row = session.execute(
        text(_select_sql("st.id = :id AND st.creator_user_id = :uid", lock=lock)),
        {"id": schedule_id, "uid": user_id},
    ).one_or_none()
    if row is None:
        raise DomainError(
            "SCHEDULED_TRANSFER_NOT_FOUND", "No Scheduled Transfer found with that ID.", 404
        )
    return row


def cancel(session: Session, *, schedule_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    row = get(session, schedule_id=schedule_id, user_id=user_id, lock=True)
    if row.status == "CANCELLED":
        return _resource(row)
    if row.status != "SCHEDULED":
        raise DomainError(
            "SCHEDULED_TRANSFER_NOT_PENDING",
            "That Scheduled Transfer has already been resolved.",
            409,
        )
    session.execute(
        text(
            "UPDATE scheduled_transfers SET status = 'CANCELLED', resolved_at = now() "
            "WHERE id = :id"
        ),
        {"id": schedule_id},
    )
    ledger.audit(
        session,
        "SCHEDULED_TRANSFER_CANCELLED",
        actor_user_id=user_id,
        resource_type="scheduled_transfer",
        resource_id=schedule_id,
        metadata={"reference": row.public_reference},
    )
    return _resource(get(session, schedule_id=schedule_id, user_id=user_id))


def execute_next_due(session: Session) -> dict | None:
    """Claim and resolve one due instruction inside the caller's transaction."""
    set_lock_timeout(session)
    row = session.execute(
        text(
            """
            SELECT st.id, st.public_reference, st.creator_user_id,
                   st.sender_account_id, st.recipient_account_id, st.amount_poisha,
                   st.note, sender.pin_hash, recipient.phone AS recipient_phone
            FROM scheduled_transfers st
            JOIN accounts sender_account ON sender_account.id = st.sender_account_id
            JOIN users sender ON sender.id = sender_account.user_id
            JOIN accounts recipient_account ON recipient_account.id = st.recipient_account_id
            JOIN users recipient ON recipient.id = recipient_account.user_id
            WHERE st.status = 'SCHEDULED' AND st.execute_at <= now()
            ORDER BY st.execute_at, st.id
            FOR UPDATE OF st SKIP LOCKED
            LIMIT 1
            """
        )
    ).one_or_none()
    if row is None:
        return None

    fingerprint = {
        "scheduledTransferId": str(row.id),
        "recipientPhone": row.recipient_phone,
        "amountPoisha": row.amount_poisha,
        "note": row.note,
    }
    try:
        with session.begin_nested():
            _, receipt = transfer.execute(
                session,
                sender_user_id=row.creator_user_id,
                sender_account_id=row.sender_account_id,
                sender_pin_hash=row.pin_hash,
                recipients=[
                    transfer.Recipient(
                        phone=row.recipient_phone, amount_poisha=row.amount_poisha
                    )
                ],
                note=row.note,
                pin=None,
                idempotency_key="scheduled:" + str(row.id),
                request_hash=idem.hash_request(fingerprint),
                receipt_context={"scheduledTransferId": str(row.id)},
                preauthorized=True,
            )
    except DomainError as exc:
        session.execute(
            text(
                "UPDATE scheduled_transfers SET status = 'FAILED', failure_code = :code, "
                "failure_message = :message, resolved_at = now() WHERE id = :id"
            ),
            {"id": row.id, "code": exc.code, "message": exc.message[:240]},
        )
        notifications.create(
            session,
            user_id=row.creator_user_id,
            kind="SCHEDULE_FAILED",
            title="Scheduled Transfer failed",
            message=f"{row.public_reference}: {exc.message}",
            resource_type="scheduled_transfer",
            resource_id=row.id,
        )
        ledger.audit(
            session,
            "SCHEDULED_TRANSFER_FAILED",
            actor_user_id=row.creator_user_id,
            resource_type="scheduled_transfer",
            resource_id=row.id,
            metadata={"reference": row.public_reference, "code": exc.code},
        )
        return {"status": "FAILED", "scheduledTransferId": str(row.id), "code": exc.code}

    transfer_id = uuid.UUID(receipt["transferId"])
    session.execute(
        text(
            "UPDATE scheduled_transfers SET status = 'EXECUTED', transfer_id = :tid, "
            "resolved_at = now() WHERE id = :id"
        ),
        {"id": row.id, "tid": transfer_id},
    )
    notifications.create(
        session,
        user_id=row.creator_user_id,
        kind="SCHEDULE_EXECUTED",
        title="Scheduled Transfer sent",
        message=(
            f"BDT {format_taka(row.amount_poisha)} was sent. "
            f"Transfer reference {receipt['reference']}."
        ),
        resource_type="scheduled_transfer",
        resource_id=row.id,
    )
    ledger.audit(
        session,
        "SCHEDULED_TRANSFER_EXECUTED",
        actor_user_id=row.creator_user_id,
        resource_type="scheduled_transfer",
        resource_id=row.id,
        metadata={"reference": row.public_reference, "transferId": str(transfer_id)},
    )
    return {
        "status": "EXECUTED",
        "scheduledTransferId": str(row.id),
        "transferReference": receipt["reference"],
    }
