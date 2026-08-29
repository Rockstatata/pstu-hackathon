"""Writing to the Ledger. Every money movement in the system goes through post().

Nothing else in the codebase is permitted to INSERT into journal_entries or to
UPDATE accounts.balance_poisha. One path means one place to get right, and one
place for a reviewer to read.
"""

import secrets
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..errors import DomainError


@dataclass(frozen=True)
class Leg:
    """One side of a movement. amount_poisha is signed: negative debits."""

    account_id: uuid.UUID
    amount_poisha: int


_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no I, L, O, 0, 1 -- read aloud safely


class InjectedFailure(RuntimeError):
    """Chaos-laboratory failure after Journal writes, before balance updates."""


def new_reference() -> str:
    return "TXN" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(11))


def lock_accounts(session: Session, account_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Lock every Account this movement touches, in ascending id order.

    ADR-0003: the ordering is global and applies to one-to-one transfers, group
    transfers and reversals alike. Two movements that share accounts therefore
    always request them in the same sequence, so neither can hold what the other
    waits for. This is why there is no deadlock retry loop -- a retry would either
    be dead code or would hide a violation of this ordering.
    """
    ordered = sorted(set(account_ids), key=lambda a: str(a))
    rows = session.execute(
        text(
            "SELECT id, balance_poisha FROM accounts WHERE id = ANY(:ids) "
            "ORDER BY id FOR UPDATE"
        ),
        {"ids": ordered},
    ).all()
    if len(rows) != len(ordered):
        raise DomainError("RECIPIENT_NOT_FOUND", "One of those accounts no longer exists.", 404)
    return {r.id: r.balance_poisha for r in rows}


def post(
    session: Session,
    *,
    kind: str,
    sender_account_id: uuid.UUID,
    legs: list[Leg],
    note: str | None = None,
    risk_decision: str | None = None,
    risk_reason: str | None = None,
    reversal_of: uuid.UUID | None = None,
    fail_after_journal: bool = False,
) -> tuple[uuid.UUID, str]:
    """Write a Transfer and its Journal Entries, and move the cached balances.

    Callers must already hold FOR UPDATE locks on every account in `legs`, taken
    via lock_accounts(). Returns (transfer_id, public_reference).
    """
    if sum(leg.amount_poisha for leg in legs) != 0:
        # ADR-0001: the Ledger is the truth, and truth sums to zero. A caller that
        # gets here has a bug, and it must not reach the database.
        raise DomainError("INTERNAL_ERROR", "Could not complete that transfer.", 500)

    total = sum(leg.amount_poisha for leg in legs if leg.amount_poisha > 0)
    transfer_id = uuid.uuid4()
    reference = new_reference()

    session.execute(
        text(
            "INSERT INTO transfers (id, public_reference, kind, sender_account_id, "
            "total_poisha, note, status, risk_decision, risk_reason, reversal_of) "
            "VALUES (:id, :ref, :kind, :sender, :total, :note, 'COMPLETED', :rd, :rr, :rev)"
        ),
        {
            "id": transfer_id,
            "ref": reference,
            "kind": kind,
            "sender": sender_account_id,
            "total": total,
            "note": note,
            "rd": risk_decision,
            "rr": risk_reason,
            "rev": reversal_of,
        },
    )

    session.execute(
        text(
            "INSERT INTO journal_entries (id, transfer_id, account_id, amount_poisha) "
            "VALUES (:id, :tid, :aid, :amt)"
        ),
        [
            {
                "id": uuid.uuid4(),
                "tid": transfer_id,
                "aid": leg.account_id,
                "amt": leg.amount_poisha,
            }
            for leg in legs
        ],
    )

    if fail_after_journal:
        raise InjectedFailure("injected failure after journal entries")

    # The cached balance moves in the same statement batch as the entries that
    # justify it (ADR-0001). The CHECK constraint on accounts is the last line of
    # defence: if application logic ever lets a balance go negative, the database
    # aborts the transaction rather than recording it.
    session.execute(
        text(
            "UPDATE accounts SET balance_poisha = balance_poisha + :amt, updated_at = now() "
            "WHERE id = :aid"
        ),
        [{"aid": leg.account_id, "amt": leg.amount_poisha} for leg in legs],
    )

    return transfer_id, reference


def audit(
    session: Session,
    event_type: str,
    *,
    actor_user_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: uuid.UUID | None = None,
    metadata: dict | None = None,
) -> None:
    import json

    session.execute(
        text(
            "INSERT INTO audit_events (id, event_type, actor_user_id, resource_type, "
            "resource_id, metadata_json) VALUES (:id, :et, :actor, :rt, :rid, CAST(:meta AS jsonb))"
        ),
        {
            "id": uuid.uuid4(),
            "et": event_type,
            "actor": actor_user_id,
            "rt": resource_type,
            "rid": resource_id,
            "meta": json.dumps(metadata or {}, default=str),
        },
    )
