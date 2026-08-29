"""Money Request lifecycle.

A Money Request is a consent workflow around the Transfer engine, not a second
money path. Creating, declining, and cancelling never touch the Ledger. Paying
locks the request and calls transfer.execute() in the same database transaction.
"""

import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import idempotency as idem
from .. import policy
from ..db import set_lock_timeout
from ..errors import DomainError
from ..money import format_taka
from . import ledger, notifications, transfer

_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
VALID_STATUSES = {"PENDING", "PAID", "DECLINED", "CANCELLED", "EXPIRED"}


def new_reference() -> str:
    return "REQ" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(11))


def _effective_status(row) -> str:
    if row.status == "PENDING" and row.expires_at <= datetime.now(timezone.utc):
        return "EXPIRED"
    return row.status


def _resource(row, viewer_account_id: uuid.UUID) -> dict:
    return {
        "requestId": str(row.id),
        "reference": row.public_reference,
        "direction": "outgoing" if row.requester_account_id == viewer_account_id else "incoming",
        "status": _effective_status(row),
        "amountPoisha": row.amount_poisha,
        "reason": row.reason,
        "requester": {
            "name": row.requester_name,
            "maskedPhone": transfer.mask_phone(row.requester_phone),
        },
        "payer": {
            "name": row.payer_name,
            "maskedPhone": transfer.mask_phone(row.payer_phone),
        },
        "transferReference": row.transfer_reference,
        "createdAt": row.created_at.isoformat(),
        "expiresAt": row.expires_at.isoformat(),
        "resolvedAt": row.resolved_at.isoformat() if row.resolved_at else None,
        "requestKind": "REVERSAL" if row.reversal_of_transfer_id else "STANDARD",
        "originalTransferReference": row.original_transfer_reference,
    }


def _select_one(
    session: Session,
    request_id: uuid.UUID,
    viewer_account_id: uuid.UUID,
    *,
    lock: bool = False,
):
    suffix = " FOR UPDATE OF mr" if lock else ""
    return session.execute(
        text(
            """
            SELECT mr.*, requester.name AS requester_name,
                   requester.phone AS requester_phone,
                   payer.name AS payer_name, payer.phone AS payer_phone,
                   t.public_reference AS transfer_reference,
                   original.public_reference AS original_transfer_reference
            FROM money_requests mr
            JOIN accounts requester_account ON requester_account.id = mr.requester_account_id
            JOIN users requester ON requester.id = requester_account.user_id
            JOIN accounts payer_account ON payer_account.id = mr.payer_account_id
            JOIN users payer ON payer.id = payer_account.user_id
            LEFT JOIN transfers t ON t.id = mr.transfer_id
            LEFT JOIN transfers original ON original.id = mr.reversal_of_transfer_id
            WHERE mr.id = :id
              AND (:viewer = mr.requester_account_id OR :viewer = mr.payer_account_id)
            """
            + suffix
        ),
        {"id": request_id, "viewer": viewer_account_id},
    ).one_or_none()


def _require_visible(
    session: Session,
    request_id: uuid.UUID,
    viewer_account_id: uuid.UUID,
    *,
    lock: bool = False,
):
    row = _select_one(session, request_id, viewer_account_id, lock=lock)
    if row is None:
        # Unknown and unauthorized are deliberately indistinguishable.
        raise DomainError(
            "MONEY_REQUEST_NOT_FOUND", "No money request found with that ID.", 404
        )
    return row


def create(
    session: Session,
    *,
    requester_user_id: uuid.UUID,
    requester_account_id: uuid.UUID,
    payer_phone: str,
    amount_poisha: int,
    reason: str,
    idempotency_key: str,
    request_hash: str,
    reversal_of_transfer_id: uuid.UUID | None = None,
) -> tuple[int, dict]:
    policy.check_amount(amount_poisha)
    set_lock_timeout(session)
    record_id = idem.reserve(
        session, requester_user_id, idempotency_key, request_hash, "money_request"
    )

    payer = session.execute(
        text(
            "SELECT a.id AS account_id FROM users u "
            "JOIN accounts a ON a.user_id = u.id "
            "WHERE u.phone = :phone AND u.is_system = FALSE"
        ),
        {"phone": payer_phone},
    ).one_or_none()
    if payer is None:
        raise DomainError(
            "RECIPIENT_NOT_FOUND", "No account is registered to that number.", 404
        )
    if payer.account_id == requester_account_id:
        raise DomainError(
            "SELF_TRANSFER_NOT_ALLOWED", "You cannot request money from yourself."
        )

    request_id = uuid.uuid4()
    reference = new_reference()
    session.execute(
        text(
            "INSERT INTO money_requests "
            "(id, public_reference, requester_account_id, payer_account_id, amount_poisha, "
            "reason, reversal_of_transfer_id) "
            "VALUES (:id, :ref, :requester, :payer, :amount, :reason, :reversal)"
        ),
        {
            "id": request_id,
            "ref": reference,
            "requester": requester_account_id,
            "payer": payer.account_id,
            "amount": amount_poisha,
            "reason": reason,
            "reversal": reversal_of_transfer_id,
        },
    )
    row = _require_visible(session, request_id, requester_account_id)
    body = _resource(row, requester_account_id)
    ledger.audit(
        session,
        "MONEY_REQUEST_CREATED",
        actor_user_id=requester_user_id,
        resource_type="money_request",
        resource_id=request_id,
        metadata={"reference": reference, "amountPoisha": amount_poisha},
    )
    payer_user_id = session.execute(
        text("SELECT user_id FROM accounts WHERE id = :aid"), {"aid": payer.account_id}
    ).scalar_one()
    notifications.create(
        session,
        user_id=payer_user_id,
        kind="REVERSAL_REQUESTED" if reversal_of_transfer_id else "REQUEST_RECEIVED",
        title="Reversal approval requested" if reversal_of_transfer_id else "Money requested",
        message=(
            f"Review the Reversal request for BDT {format_taka(amount_poisha)}."
            if reversal_of_transfer_id
            else f"A Chorui user requested BDT {format_taka(amount_poisha)}."
        ),
        resource_type="money_request",
        resource_id=request_id,
    )
    idem.finalize(session, record_id, request_id, 201, body)
    return 201, body


def get(
    session: Session, request_id: uuid.UUID, viewer_account_id: uuid.UUID
) -> dict:
    return _resource(
        _require_visible(session, request_id, viewer_account_id), viewer_account_id
    )


def list_for_account(
    session: Session,
    *,
    viewer_account_id: uuid.UUID,
    direction: str,
    status: str | None,
    limit: int,
) -> dict:
    account_column = (
        "mr.payer_account_id" if direction == "incoming" else "mr.requester_account_id"
    )
    status_clause = ""
    params: dict = {"viewer": viewer_account_id, "limit": limit}
    if status:
        status_clause = (
            "AND CASE WHEN mr.status = 'PENDING' AND mr.expires_at <= now() "
            "THEN 'EXPIRED' ELSE mr.status END = :status"
        )
        params["status"] = status

    rows = session.execute(
        text(
            f"""
            SELECT mr.*, requester.name AS requester_name,
                   requester.phone AS requester_phone,
                   payer.name AS payer_name, payer.phone AS payer_phone,
                   t.public_reference AS transfer_reference,
                   original.public_reference AS original_transfer_reference
            FROM money_requests mr
            JOIN accounts requester_account ON requester_account.id = mr.requester_account_id
            JOIN users requester ON requester.id = requester_account.user_id
            JOIN accounts payer_account ON payer_account.id = mr.payer_account_id
            JOIN users payer ON payer.id = payer_account.user_id
            LEFT JOIN transfers t ON t.id = mr.transfer_id
            LEFT JOIN transfers original ON original.id = mr.reversal_of_transfer_id
            WHERE {account_column} = :viewer {status_clause}
            ORDER BY mr.created_at DESC, mr.id DESC
            LIMIT :limit
            """
        ),
        params,
    ).all()
    return {"moneyRequests": [_resource(row, viewer_account_id) for row in rows]}


def pay(
    session: Session,
    *,
    request_id: uuid.UUID,
    payer_user_id: uuid.UUID,
    payer_account_id: uuid.UUID,
    payer_pin_hash: str,
    pin: str | None,
    idempotency_key: str,
    request_hash: str,
) -> tuple[int, dict]:
    set_lock_timeout(session)
    row = _require_visible(session, request_id, payer_account_id, lock=True)
    if row.payer_account_id != payer_account_id:
        raise DomainError(
            "MONEY_REQUEST_NOT_FOUND", "No money request found with that ID.", 404
        )

    status = _effective_status(row)
    if status == "EXPIRED":
        raise DomainError(
            "MONEY_REQUEST_EXPIRED", "This money request has expired.", 409
        )
    if status == "PAID":
        # The original key replays the exact receipt. A new key is a conflicting
        # second attempt and is rejected below.
        idem.peek(session, payer_user_id, idempotency_key, request_hash)
    if status != "PENDING":
        raise DomainError(
            "MONEY_REQUEST_NOT_PENDING",
            "This money request is no longer pending.",
            409,
        )

    receipt_context = {
        "moneyRequestId": str(row.id),
        "moneyRequestReference": row.public_reference,
    }
    result = transfer.execute(
        session,
        sender_user_id=payer_user_id,
        sender_account_id=payer_account_id,
        sender_pin_hash=payer_pin_hash,
        recipients=[
            transfer.Recipient(
                phone=row.requester_phone, amount_poisha=row.amount_poisha
            )
        ],
        note=row.reason,
        pin=pin,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        receipt_context=receipt_context,
        kind_override="REVERSAL" if row.reversal_of_transfer_id else None,
        reversal_of=row.reversal_of_transfer_id,
    )
    transfer_id = uuid.UUID(result[1]["transferId"])
    session.execute(
        text(
            "UPDATE money_requests SET status = 'PAID', transfer_id = :tid, "
            "resolved_at = now() WHERE id = :id AND status = 'PENDING'"
        ),
        {"id": request_id, "tid": transfer_id},
    )
    if row.reversal_of_transfer_id:
        session.execute(
            text("UPDATE transfers SET status = 'REVERSED' WHERE id = :id"),
            {"id": row.reversal_of_transfer_id},
        )
    ledger.audit(
        session,
        "MONEY_REQUEST_PAID",
        actor_user_id=payer_user_id,
        resource_type="money_request",
        resource_id=request_id,
        metadata={"reference": row.public_reference, "transferId": transfer_id},
    )
    requester_user_id = session.execute(
        text("SELECT user_id FROM accounts WHERE id = :aid"),
        {"aid": row.requester_account_id},
    ).scalar_one()
    notifications.create(
        session,
        user_id=requester_user_id,
        kind="REQUEST_RESOLVED",
        title="Request paid",
        message=f"Your request {row.public_reference} was paid.",
        resource_type="money_request",
        resource_id=request_id,
    )
    return result


def transition(
    session: Session,
    *,
    request_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    actor_account_id: uuid.UUID,
    action: str,
) -> dict:
    set_lock_timeout(session)
    row = _require_visible(session, request_id, actor_account_id, lock=True)
    expected_actor = row.payer_account_id if action == "DECLINED" else row.requester_account_id
    if actor_account_id != expected_actor:
        raise DomainError(
            "MONEY_REQUEST_NOT_FOUND", "No money request found with that ID.", 404
        )

    status = _effective_status(row)
    if status == "EXPIRED":
        raise DomainError(
            "MONEY_REQUEST_EXPIRED", "This money request has expired.", 409
        )
    if status == action:
        return _resource(row, actor_account_id)
    if status != "PENDING":
        raise DomainError(
            "MONEY_REQUEST_NOT_PENDING",
            "This money request is no longer pending.",
            409,
        )

    session.execute(
        text(
            "UPDATE money_requests SET status = :status, resolved_at = now() "
            "WHERE id = :id AND status = 'PENDING'"
        ),
        {"id": request_id, "status": action},
    )
    ledger.audit(
        session,
        "MONEY_REQUEST_" + action,
        actor_user_id=actor_user_id,
        resource_type="money_request",
        resource_id=request_id,
        metadata={"reference": row.public_reference},
    )
    notify_account_id = (
        row.requester_account_id if action == "DECLINED" else row.payer_account_id
    )
    notify_user_id = session.execute(
        text("SELECT user_id FROM accounts WHERE id = :aid"),
        {"aid": notify_account_id},
    ).scalar_one()
    notifications.create(
        session,
        user_id=notify_user_id,
        kind="REQUEST_RESOLVED",
        title="Request " + action.lower(),
        message=f"Money Request {row.public_reference} was {action.lower()}.",
        resource_type="money_request",
        resource_id=request_id,
    )
    updated = _require_visible(session, request_id, actor_account_id)
    return _resource(updated, actor_account_id)


def create_reversal_request(
    session: Session,
    *,
    requester_user_id: uuid.UUID,
    requester_account_id: uuid.UUID,
    transfer_reference: str,
    idempotency_key: str,
    request_hash: str,
) -> tuple[int, dict]:
    """Ask the original recipient to compensate a P2P Transfer."""
    set_lock_timeout(session)
    row = session.execute(
        text(
            """
            SELECT t.id, t.kind, t.total_poisha, recipient.phone AS recipient_phone,
                   mr.id AS existing_request_id
            FROM transfers t
            JOIN journal_entries recipient_je
              ON recipient_je.transfer_id = t.id AND recipient_je.amount_poisha > 0
            JOIN accounts recipient_account ON recipient_account.id = recipient_je.account_id
            JOIN users recipient ON recipient.id = recipient_account.user_id
            LEFT JOIN money_requests mr ON mr.reversal_of_transfer_id = t.id
            WHERE t.public_reference = :reference
              AND t.sender_account_id = :requester_account
            FOR UPDATE OF t
            """
        ),
        {"reference": transfer_reference, "requester_account": requester_account_id},
    ).one_or_none()
    if row is None:
        raise DomainError("TRANSFER_NOT_FOUND", "No transaction found with that ID.", 404)

    # A duplicate waiting on the Transfer lock must replay the winner before it
    # sees the winner's request as a different business intention.
    idem.peek(session, requester_user_id, idempotency_key, request_hash)
    if row.kind != "P2P":
        reason = (
            "Individual Group Transfer legs cannot be reversed."
            if row.kind == "GROUP"
            else "A Reversal cannot itself be reversed."
        )
        raise DomainError("TRANSFER_NOT_REVERSIBLE", reason, 409)
    if row.existing_request_id is not None:
        raise DomainError(
            "REVERSAL_ALREADY_REQUESTED",
            "A Reversal request already exists for this Transfer.",
            409,
        )

    return create(
        session,
        requester_user_id=requester_user_id,
        requester_account_id=requester_account_id,
        payer_phone=row.recipient_phone,
        amount_poisha=row.total_poisha,
        reason=f"Reversal requested for {transfer_reference}",
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        reversal_of_transfer_id=row.id,
    )
