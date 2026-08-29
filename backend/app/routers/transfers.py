import uuid

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import idempotency as idem
from ..config import settings
from ..db import SessionLocal, get_session
from ..deps import CurrentUser, current_user
from ..errors import DomainError
from ..services import ledger, transfer

router = APIRouter(tags=["transfers"])

# Which rejections are worth a permanent record. These are the numbers the
# integrity dashboard shows as "rejected overspends" and "step-ups triggered",
# so they must survive the rollback that produced them.
AUDITED_REJECTIONS = {
    "INSUFFICIENT_FUNDS": "INSUFFICIENT_FUNDS",
    "TRANSFER_LIMIT_EXCEEDED": "TRANSFER_REJECTED",
    "STEP_UP_REQUIRED": "STEP_UP_REQUIRED",
    "STEP_UP_FAILED": "STEP_UP_REJECTED",
    "SELF_TRANSFER_NOT_ALLOWED": "TRANSFER_REJECTED",
    "RECIPIENT_NOT_FOUND": "TRANSFER_REJECTED",
    "INVALID_AMOUNT": "TRANSFER_REJECTED",
}


class RecipientBody(BaseModel):
    phone: str
    amount_poisha: int = Field(alias="amountPoisha")

    model_config = {"populate_by_name": True}


class TransferBody(BaseModel):
    """Accepts the one-to-one shorthand and the group form.

    Both snake_case and camelCase are accepted on input. This is not indecision --
    the frontend and the load tests were written against different conventions, and
    a field-name mismatch discovered at demo time is a worse outcome than an alias.
    """

    recipients: list[RecipientBody] | None = Field(
        default=None, max_length=settings.max_group_recipients
    )
    recipient_phone: str | None = Field(default=None, alias="recipientPhone")
    amount_poisha: int | None = Field(default=None, alias="amountPoisha")
    note: str | None = Field(default=None, max_length=140)
    pin: str | None = None

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def normalise(self):
        if not self.recipients:
            if not self.recipient_phone or self.amount_poisha is None:
                raise ValueError("Provide a recipient and an amount.")
            self.recipients = [
                RecipientBody(phone=self.recipient_phone, amount_poisha=self.amount_poisha)
            ]
        return self

    def fingerprint(self) -> dict:
        """What the Idempotency-Key is a key FOR.

        The PIN is deliberately excluded. A transfer that came back asking for a
        Step-Up and is resubmitted with the PIN is the same intention, so it must
        reuse the same key rather than being rejected as a different request.
        """
        return {
            "recipients": sorted(
                ({"phone": r.phone, "amount": r.amount_poisha} for r in self.recipients or []),
                key=lambda r: r["phone"],
            ),
            "note": self.note,
        }


def _audit_rejection(user: CurrentUser, exc: DomainError, body: TransferBody) -> None:
    """Record the rejection on a fresh session.

    The transaction that produced this error rolled back, taking any audit row
    written inside it with it. That rollback is correct -- no money moved, and the
    Idempotency-Key is released so the user can genuinely retry -- but the fact
    that we rejected them is still something we want to be able to show.
    """
    event = AUDITED_REJECTIONS.get(exc.code)
    if not event:
        return
    with SessionLocal() as session:
        ledger.audit(
            session,
            event,
            actor_user_id=user.user_id,
            resource_type="transfer",
            metadata={"code": exc.code, "recipients": len(body.recipients or [])},
        )
        session.commit()


@router.post("/transfers")
def create_transfer(
    body: TransferBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request(body.fingerprint())

    # Cheap pre-check for the common storm case. Not the guard -- reserve() is.
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        response.status_code = replay.status_code
        response.headers["X-Idempotent-Replay"] = "true"
        _count_replay(user.user_id)
        return replay.body

    try:
        status, receipt = transfer.execute(
            session,
            sender_user_id=user.user_id,
            sender_account_id=user.account_id,
            sender_pin_hash=user.pin_hash,
            recipients=[
                transfer.Recipient(phone=r.phone, amount_poisha=r.amount_poisha)
                for r in body.recipients or []
            ],
            note=body.note,
            pin=body.pin,
            idempotency_key=key,
            request_hash=request_hash,
        )
        session.commit()
    except idem.ReplayResult as replay:
        session.rollback()
        response.status_code = replay.status_code
        response.headers["X-Idempotent-Replay"] = "true"
        _count_replay(user.user_id)
        return replay.body
    except DomainError as exc:
        session.rollback()
        _audit_rejection(user, exc, body)
        raise

    response.status_code = status
    response.headers["X-Idempotent-Replay"] = "false"
    return receipt


def _count_replay(user_id: uuid.UUID) -> None:
    with SessionLocal() as session:
        ledger.audit(session, "IDEMPOTENT_REPLAY", actor_user_id=user_id, resource_type="transfer")
        session.commit()


@router.get("/transfers")
def list_transfers(
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
    limit: int = 50,
    direction: str | None = None,
):
    """This Account's movements, read from the Ledger rather than from transfers.

    Reading the journal is what makes a Group Transfer show up correctly for each
    recipient: they see their own leg, not the sender's total.
    """
    clause = ""
    if direction == "sent":
        clause = "AND je.amount_poisha < 0"
    elif direction == "received":
        clause = "AND je.amount_poisha > 0"

    rows = session.execute(
        text(
            f"""
            SELECT t.public_reference, t.kind, t.status, t.note, t.created_at,
                   t.risk_reason, je.amount_poisha, t.sender_account_id,
                   CASE WHEN je.amount_poisha < 0 THEN (
                       SELECT COALESCE(
                           jsonb_agg(
                               jsonb_build_object(
                                   'name', recipient_user.name,
                                   'phone', recipient_user.phone,
                                   'amountPoisha', recipient_je.amount_poisha
                               ) ORDER BY recipient_user.phone
                           ),
                           '[]'::jsonb
                       )
                       FROM journal_entries recipient_je
                       JOIN accounts recipient_account
                         ON recipient_account.id = recipient_je.account_id
                       JOIN users recipient_user
                         ON recipient_user.id = recipient_account.user_id
                       WHERE recipient_je.transfer_id = t.id
                         AND recipient_je.amount_poisha > 0
                   ) ELSE jsonb_build_array(
                       jsonb_build_object(
                           'name', su.name,
                           'phone', su.phone,
                           'amountPoisha', je.amount_poisha
                       )
                   ) END AS counterparties
            FROM journal_entries je
            JOIN transfers t ON t.id = je.transfer_id
            JOIN accounts sa ON sa.id = t.sender_account_id
            JOIN users su ON su.id = sa.user_id
            WHERE je.account_id = :aid {clause}
            ORDER BY t.created_at DESC, je.id
            LIMIT :limit
            """
        ),
        {"aid": user.account_id, "limit": min(limit, 200)},
    ).all()

    return {"transactions": [_row_to_item(r) for r in rows]}


def _row_to_item(r) -> dict:
    outgoing = r.amount_poisha < 0
    parties = [
        {
            "name": counterparty["name"],
            "maskedPhone": transfer.mask_phone(counterparty["phone"]),
            "amountPoisha": counterparty["amountPoisha"],
        }
        for counterparty in r.counterparties
    ]

    return {
        "reference": r.public_reference,
        "kind": r.kind,
        "status": r.status,
        "note": r.note,
        "riskReason": r.risk_reason,
        "direction": "sent" if outgoing else "received",
        "amountPoisha": r.amount_poisha,
        "createdAt": r.created_at.isoformat(),
        "counterparties": parties,
    }


@router.get("/transfers/{reference}")
def get_transfer(
    reference: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    row = session.execute(
        text(
            """
            SELECT t.public_reference, t.kind, t.status, t.note, t.created_at,
                   t.risk_reason, je.amount_poisha, t.sender_account_id,
                   CASE WHEN je.amount_poisha < 0 THEN (
                       SELECT COALESCE(
                           jsonb_agg(
                               jsonb_build_object(
                                   'name', recipient_user.name,
                                   'phone', recipient_user.phone,
                                   'amountPoisha', recipient_je.amount_poisha
                               ) ORDER BY recipient_user.phone
                           ),
                           '[]'::jsonb
                       )
                       FROM journal_entries recipient_je
                       JOIN accounts recipient_account
                         ON recipient_account.id = recipient_je.account_id
                       JOIN users recipient_user
                         ON recipient_user.id = recipient_account.user_id
                       WHERE recipient_je.transfer_id = t.id
                         AND recipient_je.amount_poisha > 0
                   ) ELSE jsonb_build_array(
                       jsonb_build_object(
                           'name', su.name,
                           'phone', su.phone,
                           'amountPoisha', je.amount_poisha
                       )
                   ) END AS counterparties
            FROM journal_entries je
            JOIN transfers t ON t.id = je.transfer_id
            JOIN accounts sa ON sa.id = t.sender_account_id
            JOIN users su ON su.id = sa.user_id
            WHERE t.public_reference = :ref AND je.account_id = :aid
            """
        ),
        {"ref": reference, "aid": user.account_id},
    ).one_or_none()

    # A Transfer this Account has no leg in is not visible to it, and it is not
    # visible as "forbidden" either -- that would confirm the reference exists.
    if row is None:
        raise DomainError("TRANSFER_NOT_FOUND", "No transaction found with that ID.", 404)

    item = _row_to_item(row)
    item["reversible"] = (
        row.kind == "P2P" and row.amount_poisha < 0
    )
    if not item["reversible"]:
        item["notReversibleReason"] = (
            "Group transfers cannot be reversed one recipient at a time."
            if row.kind == "GROUP"
            else "A reversal cannot itself be reversed."
            if row.kind == "REVERSAL"
            else "Only money you sent can be reversed."
        )
    return item
