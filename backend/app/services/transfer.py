"""The transfer engine. Every taka that moves between Users moves through execute().

One-to-one and Group Transfers are the same code path with a different number of
recipients (ADR-0002): a group is atomic because it is literally one Transfer, one
set of Journal Entries, one commit -- not N transfers wrapped in optimism.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import idempotency as idem
from .. import policy
from ..config import settings
from ..db import set_lock_timeout
from ..errors import DomainError
from ..money import format_taka
from ..security import verify_pin
from . import ledger, notifications


@dataclass(frozen=True)
class Recipient:
    phone: str
    amount_poisha: int


@dataclass(frozen=True)
class ResolvedRecipient:
    account_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    phone: str
    amount_poisha: int


def mask_phone(phone: str) -> str:
    """017*****432 -- enough to recognise, not enough to harvest."""
    if len(phone) <= 6:
        return phone
    return phone[:3] + "*" * (len(phone) - 6) + phone[-3:]


def resolve_recipients(session: Session, recipients: list[Recipient]) -> list[ResolvedRecipient]:
    if not recipients:
        raise DomainError("RECIPIENT_NOT_FOUND", "Add at least one person to send to.")
    if len(recipients) > settings.max_group_recipients:
        raise DomainError(
            "TRANSFER_LIMIT_EXCEEDED",
            f"A Group Transfer can include up to {settings.max_group_recipients} people.",
        )

    # Validate every submitted amount before merging duplicate phone numbers.
    # Otherwise +200 and -100 for one recipient silently becomes a valid +100.
    for recipient in recipients:
        if recipient.amount_poisha <= 0:
            raise DomainError("INVALID_AMOUNT", "Enter an amount greater than zero.")

    # Merge repeats so one person named twice in a group gets one leg, not two
    # legs racing to update the same locked row.
    merged: dict[str, int] = {}
    for r in recipients:
        merged[r.phone] = merged.get(r.phone, 0) + r.amount_poisha

    rows = session.execute(
        text(
            "SELECT a.id AS account_id, u.id AS user_id, u.name, u.phone "
            "FROM users u JOIN accounts a ON a.user_id = u.id "
            "WHERE u.phone = ANY(:phones) AND u.is_system = FALSE"
        ),
        {"phones": list(merged.keys())},
    ).all()

    found = {r.phone: r for r in rows}
    missing = [p for p in merged if p not in found]
    if missing:
        # ADR-0002: one bad recipient fails the whole group, and we say which one.
        detail = " No one in this group was sent money." if len(merged) > 1 else ""
        raise DomainError(
            "RECIPIENT_NOT_FOUND",
            "No account found for " + missing[0] + "." + detail,
            404,
        )

    return [
        ResolvedRecipient(
            account_id=found[phone].account_id,
            user_id=found[phone].user_id,
            name=found[phone].name,
            phone=phone,
            amount_poisha=amount,
        )
        for phone, amount in merged.items()
    ]


def _receipt(
    transfer_id: uuid.UUID,
    reference: str,
    kind: str,
    total_poisha: int,
    recipients: list[ResolvedRecipient],
    note: str | None,
    risk_reason: str | None,
    balance_after: int,
) -> dict:
    return {
        "transferId": str(transfer_id),
        "reference": reference,
        "kind": kind,
        "status": "COMPLETED",
        "totalPoisha": total_poisha,
        "note": note,
        "riskReason": risk_reason,
        "senderBalanceAfterPoisha": balance_after,
        "completedAt": datetime.now(timezone.utc).isoformat(),
        "recipients": [
            {
                "name": r.name,
                "maskedPhone": mask_phone(r.phone),
                "amountPoisha": r.amount_poisha,
            }
            for r in recipients
        ],
    }


def execute(
    session: Session,
    *,
    sender_user_id: uuid.UUID,
    sender_account_id: uuid.UUID,
    sender_pin_hash: str,
    recipients: list[Recipient],
    note: str | None,
    pin: str | None,
    idempotency_key: str,
    request_hash: str,
    receipt_context: dict | None = None,
    kind_override: str | None = None,
    reversal_of: uuid.UUID | None = None,
    preauthorized: bool = False,
    fail_after_journal: bool = False,
) -> tuple[int, dict]:
    """Run one Transfer to completion, or leave the Ledger exactly as it was.

    The whole body runs in a single database transaction. There is no partial
    outcome to clean up, because there is no intermediate state that survives.
    """
    set_lock_timeout(session)

    # Claim the key first. Everything after this point is protected by it: a
    # duplicate submission blocks here, then loses, then replays our response.
    record_id = idem.reserve(session, sender_user_id, idempotency_key, request_hash, "transfer")

    resolved = resolve_recipients(session, recipients)
    total = sum(r.amount_poisha for r in resolved)

    for r in resolved:
        if r.amount_poisha <= 0:
            raise DomainError(
                "INVALID_AMOUNT", "Enter an amount greater than zero for " + r.name + "."
            )
        if r.account_id == sender_account_id:
            raise DomainError("SELF_TRANSFER_NOT_ALLOWED", "You cannot send money to yourself.")

    policy.check_amount(total)

    recipient_ids = [r.account_id for r in resolved]
    balances = ledger.lock_accounts(session, [sender_account_id, *recipient_ids])

    # Read the balance only after the lock. A balance read before the lock is a
    # balance another transfer may already have spent.
    sender_balance = balances[sender_account_id]
    if sender_balance < total:
        raise DomainError(
            "INSUFFICIENT_FUNDS",
            "You have BDT "
            + format_taka(sender_balance)
            + ", which is not enough to send BDT "
            + format_taka(total)
            + ".",
        )

    policy.check_daily_total(session, sender_account_id, total)

    risk = policy.assess(session, sender_account_id, recipient_ids, total)
    if risk.step_up_required and not preauthorized:
        if not pin:
            raise DomainError(
                "STEP_UP_REQUIRED",
                risk.reason or "Confirm this transfer with your PIN.",
                403,
                stepUpReason=risk.reason,
            )
        if not verify_pin(pin, sender_pin_hash):
            raise DomainError("STEP_UP_FAILED", "That PIN is not correct.", 403)

    kind = kind_override or ("GROUP" if len(resolved) > 1 else "P2P")
    legs = [ledger.Leg(sender_account_id, -total)]
    legs += [ledger.Leg(r.account_id, r.amount_poisha) for r in resolved]

    transfer_id, reference = ledger.post(
        session,
        kind=kind,
        sender_account_id=sender_account_id,
        legs=legs,
        note=note,
        risk_decision=risk.decision,
        risk_reason=risk.reason,
        reversal_of=reversal_of,
        fail_after_journal=fail_after_journal,
    )

    body = _receipt(
        transfer_id, reference, kind, total, resolved, note, risk.reason, sender_balance - total
    )
    if receipt_context:
        body.update(receipt_context)

    ledger.audit(
        session,
        "TRANSFER_COMPLETED",
        actor_user_id=sender_user_id,
        resource_type="transfer",
        resource_id=transfer_id,
        metadata={"reference": reference, "totalPoisha": total, "recipients": len(resolved)},
    )
    for recipient in resolved:
        notifications.create(
            session,
            user_id=recipient.user_id,
            kind="MONEY_RECEIVED",
            title="Money received",
            message=f"You received BDT {format_taka(recipient.amount_poisha)}. Reference {reference}.",
            resource_type="transfer",
            resource_id=transfer_id,
        )

    # Committed in the same transaction as the money. A crash after commit replays
    # this response; a crash before commit leaves neither the money nor the record.
    idem.finalize(session, record_id, transfer_id, 201, body)

    return 201, body


def issue_registration_grant(session: Session, user_id: uuid.UUID, account_id: uuid.UUID) -> str:
    """Fund a new Account from the Issuance Account.

    This is the only way money enters the system, and it is still a two-legged
    Transfer -- the issuance account goes further negative by exactly what the new
    user receives, so the Ledger still sums to zero the instant after registration.
    """
    issuance_id = session.execute(
        text("SELECT id FROM accounts WHERE kind = 'ISSUANCE'")
    ).scalar_one()

    amount = settings.signup_grant_poisha
    ledger.lock_accounts(session, [issuance_id, account_id])

    transfer_id, reference = ledger.post(
        session,
        kind="ISSUANCE",
        sender_account_id=issuance_id,
        legs=[ledger.Leg(issuance_id, -amount), ledger.Leg(account_id, amount)],
        note="Welcome grant",
    )
    ledger.audit(
        session,
        "REGISTRATION_GRANT_ISSUED",
        actor_user_id=user_id,
        resource_type="transfer",
        resource_id=transfer_id,
        metadata={"reference": reference, "amountPoisha": amount},
    )
    return reference
