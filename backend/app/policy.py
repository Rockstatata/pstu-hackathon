"""Transfer Policy and Step-Up rules.

Every decision in this module is a deterministic function of values already in the
database. There is no model, no score, no heuristic (ADR-0006) -- when a judge asks
"why did it block that transfer?", the answer is a line in a table on this page.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .errors import DomainError
from .money import format_taka


def check_amount(amount_poisha: int) -> None:
    if amount_poisha <= 0:
        raise DomainError("INVALID_AMOUNT", "Enter an amount greater than zero.")
    if amount_poisha > settings.max_transfer_poisha:
        raise DomainError(
            "TRANSFER_LIMIT_EXCEEDED",
            f"You can send up to BDT {format_taka(settings.max_transfer_poisha)} in one transfer.",
        )


def check_daily_total(session: Session, sender_account_id: uuid.UUID, amount_poisha: int) -> None:
    """Sum of money that has LEFT this Account today, from the Ledger itself.

    Read inside the same transaction that holds the sender's row lock, so two
    concurrent transfers cannot both see a stale daily total and both pass.
    """
    spent_today = session.execute(
        text(
            """
            SELECT COALESCE(-SUM(amount_poisha), 0)
            FROM journal_entries
            WHERE account_id = :aid
              AND amount_poisha < 0
              AND created_at >= (
                    date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka')
                    AT TIME ZONE 'Asia/Dhaka'
              )
            """
        ),
        {"aid": sender_account_id},
    ).scalar_one()

    if spent_today + amount_poisha > settings.max_daily_send_poisha:
        remaining = max(0, settings.max_daily_send_poisha - spent_today)
        raise DomainError(
            "TRANSFER_LIMIT_EXCEEDED",
            f"That would pass your daily limit of BDT {format_taka(settings.max_daily_send_poisha)}. "
            f"You can still send BDT {format_taka(remaining)} today.",
        )


@dataclass(frozen=True)
class RiskDecision:
    step_up_required: bool
    reason: str | None

    @property
    def decision(self) -> str:
        return "STEP_UP" if self.step_up_required else "ALLOW"


def assess(
    session: Session,
    sender_account_id: uuid.UUID,
    recipient_account_ids: list[uuid.UUID],
    amount_poisha: int,
) -> RiskDecision:
    """The rule table. First matching rule wins, and its text is what the user sees."""

    # Rule 1 -- large amount.
    if amount_poisha >= settings.stepup_amount_poisha:
        return RiskDecision(
            True,
            f"Transfers of BDT {format_taka(settings.stepup_amount_poisha)} or more need your PIN again.",
        )

    # Rule 2 -- first time sending to this person.
    if recipient_account_ids:
        seen = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM journal_entries je
                JOIN transfers t ON t.id = je.transfer_id
                WHERE t.sender_account_id = :sender
                  AND je.account_id = ANY(:recipients)
                  AND je.amount_poisha > 0
                """
            ),
            {"sender": sender_account_id, "recipients": recipient_account_ids},
        ).scalar_one()
        if seen == 0:
            return RiskDecision(True, "First time sending to this person.")

    # Rule 3 -- velocity.
    window_start = datetime.now(timezone.utc) - timedelta(minutes=settings.stepup_velocity_minutes)
    recent = session.execute(
        text("SELECT COUNT(*) FROM transfers WHERE sender_account_id = :aid AND created_at >= :since"),
        {"aid": sender_account_id, "since": window_start},
    ).scalar_one()
    if recent >= settings.stepup_velocity_count:
        return RiskDecision(
            True,
            f"{recent} transfers in the last {settings.stepup_velocity_minutes} minutes.",
        )

    return RiskDecision(False, None)
