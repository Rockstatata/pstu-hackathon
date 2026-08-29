"""Deterministic, read-only interpretation of completed Account activity.

This module has one interface: ``build_financial_outlook``. Callers provide an
authenticated User and receive facts plus named assessment bands. No function
here writes to an Account, Transfer, Journal Entry, or future instruction.
"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..deps import CurrentUser
from .transfer import mask_phone


DHAKA = ZoneInfo("Asia/Dhaka")
HISTORY_MONTHS = 6
BASELINE_MONTHS = 3


def _shift_month(month_start: datetime, offset: int) -> datetime:
    zero_based = month_start.year * 12 + (month_start.month - 1) + offset
    year, month_index = divmod(zero_based, 12)
    return month_start.replace(year=year, month=month_index + 1, day=1)


def _month_key(value: datetime) -> str:
    return value.strftime("%Y-%m")


def _round_div(numerator: int, denominator: int) -> int:
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    if numerator >= 0:
        return (numerator + denominator // 2) // denominator
    return -((-numerator + denominator // 2) // denominator)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def build_financial_outlook(
    session: Session,
    user: CurrentUser,
    *,
    now: datetime | None = None,
) -> dict:
    """Return transparent Account facts and deterministic assessment bands.

    Month boundaries use Asia/Dhaka. The current month is compared with the same
    elapsed portion of the previous month, while Typical Money Out uses up to
    three complete months that began after the Account existed.
    """

    as_of_utc = _as_utc(now or datetime.now(timezone.utc))
    as_of_local = as_of_utc.astimezone(DHAKA)
    current_start_local = as_of_local.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    previous_start_local = _shift_month(current_start_local, -1)
    elapsed = as_of_local - current_start_local
    previous_end_local = min(previous_start_local + elapsed, current_start_local)
    history_start_local = _shift_month(current_start_local, -(HISTORY_MONTHS - 1))

    account = session.execute(
        text(
            "SELECT balance_poisha, created_at FROM accounts "
            "WHERE id = :account_id"
        ),
        {"account_id": user.account_id},
    ).one()

    rows = session.execute(
        text(
            """
            SELECT to_char(timezone('Asia/Dhaka', je.created_at), 'YYYY-MM') AS month_key,
                   COALESCE(SUM(-je.amount_poisha)
                       FILTER (WHERE je.amount_poisha < 0), 0) AS outgoing_poisha,
                   COALESCE(SUM(je.amount_poisha)
                       FILTER (WHERE je.amount_poisha > 0), 0) AS incoming_poisha,
                   COUNT(*) AS transfer_count
            FROM journal_entries je
            JOIN transfers t ON t.id = je.transfer_id
            WHERE je.account_id = :account_id
              AND t.kind <> 'ISSUANCE'
              AND je.created_at >= :history_start
              AND je.created_at < :as_of
            GROUP BY month_key
            ORDER BY month_key
            """
        ),
        {
            "account_id": user.account_id,
            "history_start": history_start_local.astimezone(timezone.utc),
            "as_of": as_of_utc,
        },
    ).all()
    by_month = {
        row.month_key: {
            "outgoingPoisha": int(row.outgoing_poisha),
            "incomingPoisha": int(row.incoming_poisha),
            "transferCount": int(row.transfer_count),
        }
        for row in rows
    }

    previous = session.execute(
        text(
            """
            SELECT COALESCE(SUM(-je.amount_poisha)
                       FILTER (WHERE je.amount_poisha < 0), 0) AS outgoing_poisha,
                   COALESCE(SUM(je.amount_poisha)
                       FILTER (WHERE je.amount_poisha > 0), 0) AS incoming_poisha,
                   COUNT(*) AS transfer_count
            FROM journal_entries je
            JOIN transfers t ON t.id = je.transfer_id
            WHERE je.account_id = :account_id
              AND t.kind <> 'ISSUANCE'
              AND je.created_at >= :period_start
              AND je.created_at < :period_end
            """
        ),
        {
            "account_id": user.account_id,
            "period_start": previous_start_local.astimezone(timezone.utc),
            "period_end": previous_end_local.astimezone(timezone.utc),
        },
    ).one()

    current = by_month.get(
        _month_key(current_start_local),
        {"outgoingPoisha": 0, "incomingPoisha": 0, "transferCount": 0},
    )
    current_outgoing = current["outgoingPoisha"]
    current_incoming = current["incomingPoisha"]
    previous_outgoing = int(previous.outgoing_poisha)
    difference = current_outgoing - previous_outgoing
    change_bps = (
        _round_div(difference * 10_000, previous_outgoing)
        if previous_outgoing > 0
        else None
    )

    account_created_local = account.created_at.astimezone(DHAKA)
    baseline_starts = [
        _shift_month(current_start_local, -offset)
        for offset in range(1, BASELINE_MONTHS + 1)
    ]
    eligible_starts = [
        start for start in baseline_starts if account_created_local <= start
    ]
    baseline_outgoing = [
        by_month.get(_month_key(start), {"outgoingPoisha": 0})["outgoingPoisha"]
        for start in eligible_starts
    ]
    average_outgoing = (
        _round_div(sum(baseline_outgoing), len(baseline_outgoing))
        if baseline_outgoing
        else None
    )
    buffer_months_hundredths = (
        _round_div(int(account.balance_poisha) * 100, average_outgoing)
        if average_outgoing and average_outgoing > 0
        else None
    )

    recipient = session.execute(
        text(
            """
            SELECT recipient_user.name, recipient_user.phone,
                   SUM(recipient_je.amount_poisha) AS amount_poisha
            FROM journal_entries sender_je
            JOIN transfers t ON t.id = sender_je.transfer_id
            JOIN journal_entries recipient_je
              ON recipient_je.transfer_id = t.id
             AND recipient_je.amount_poisha > 0
            JOIN accounts recipient_account ON recipient_account.id = recipient_je.account_id
            JOIN users recipient_user ON recipient_user.id = recipient_account.user_id
            WHERE sender_je.account_id = :account_id
              AND sender_je.amount_poisha < 0
              AND t.kind <> 'ISSUANCE'
              AND sender_je.created_at >= :period_start
              AND sender_je.created_at < :period_end
              AND recipient_user.is_system = FALSE
            GROUP BY recipient_user.id, recipient_user.name, recipient_user.phone
            ORDER BY amount_poisha DESC, recipient_user.phone
            LIMIT 1
            """
        ),
        {
            "account_id": user.account_id,
            "period_start": current_start_local.astimezone(timezone.utc),
            "period_end": as_of_utc,
        },
    ).one_or_none()

    history = []
    for offset in range(-(HISTORY_MONTHS - 1), 1):
        start = _shift_month(current_start_local, offset)
        facts = by_month.get(
            _month_key(start),
            {"outgoingPoisha": 0, "incomingPoisha": 0, "transferCount": 0},
        )
        history.append({"month": _month_key(start), **facts})

    if change_bps is None:
        trend_band = "NO_BASELINE"
    elif change_bps >= 2_000:
        trend_band = "HIGHER"
    elif change_bps <= -1_000:
        trend_band = "LOWER"
    else:
        trend_band = "STEADY"

    if buffer_months_hundredths is None:
        buffer_band = "NO_BASELINE"
    elif buffer_months_hundredths >= 300:
        buffer_band = "THREE_PLUS_MONTHS"
    elif buffer_months_hundredths >= 100:
        buffer_band = "ONE_TO_THREE_MONTHS"
    else:
        buffer_band = "UNDER_ONE_MONTH"

    largest_recipient = None
    if recipient is not None and current_outgoing > 0:
        amount = int(recipient.amount_poisha)
        largest_recipient = {
            "name": recipient.name,
            "maskedPhone": mask_phone(recipient.phone),
            "amountPoisha": amount,
            "shareBps": _round_div(amount * 10_000, current_outgoing),
        }

    return {
        "asOf": as_of_utc.isoformat(),
        "period": {
            "currentMonth": _month_key(current_start_local),
            "currentStart": current_start_local.astimezone(timezone.utc).isoformat(),
            "comparisonMonth": _month_key(previous_start_local),
            "comparisonStart": previous_start_local.astimezone(timezone.utc).isoformat(),
            "comparisonEnd": previous_end_local.astimezone(timezone.utc).isoformat(),
        },
        "balancePoisha": int(account.balance_poisha),
        "current": {
            **current,
            "netPoisha": current_incoming - current_outgoing,
        },
        "comparison": {
            "previousOutgoingPoisha": previous_outgoing,
            "previousIncomingPoisha": int(previous.incoming_poisha),
            "previousTransferCount": int(previous.transfer_count),
            "differencePoisha": difference,
            "changeBps": change_bps,
            "band": trend_band,
        },
        "typicalMoneyOut": {
            "averagePoisha": average_outgoing,
            "completeMonthsObserved": len(eligible_starts),
            "targetMonths": BASELINE_MONTHS,
        },
        "buffer": {
            "monthsHundredths": buffer_months_hundredths,
            "band": buffer_band,
        },
        "largestRecipient": largest_recipient,
        "history": history,
        "rules": {
            "timezone": "Asia/Dhaka",
            "comparison": "Same elapsed portion of the previous calendar month",
            "typicalMoneyOut": "Average money out across up to three eligible complete calendar months",
            "trendBandsBps": {"higherAt": 2_000, "lowerAt": -1_000},
            "bufferBandsHundredths": {"threePlusAt": 300, "onePlusAt": 100},
            "issuanceExcluded": True,
        },
    }
