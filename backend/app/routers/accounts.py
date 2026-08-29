from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import CurrentUser, current_user
from ..errors import DomainError
from ..services.transfer import mask_phone

router = APIRouter(tags=["accounts"])


@router.get("/accounts/me")
def my_account(
    user: CurrentUser = Depends(current_user), session: Session = Depends(get_session)
):
    balance = session.execute(
        text("SELECT balance_poisha FROM accounts WHERE id = :aid"), {"aid": user.account_id}
    ).scalar_one()

    # asOf is what the offline banner shows as "last updated". The client caches
    # this reply; the timestamp is how the user knows how stale it is (ADR-0004).
    return {
        "accountId": str(user.account_id),
        "balancePoisha": balance,
        "currency": "BDT",
        "asOf": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/users/lookup")
def lookup_recipient(
    phone: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Recipient Verification data: enough to recognise a person, nothing more.

    Never returns a balance, a user id, or a full phone number. This endpoint is
    reachable by any authenticated user, so it must not be a directory to scrape.
    """
    phone = phone.strip().replace(" ", "").replace("-", "")
    row = session.execute(
        text(
            "SELECT u.name, u.phone FROM users u JOIN accounts a ON a.user_id = u.id "
            "WHERE u.phone = :p AND u.is_system = FALSE"
        ),
        {"p": phone},
    ).one_or_none()

    if row is None:
        raise DomainError(
            "RECIPIENT_NOT_FOUND", "No account is registered to that number.", 404
        )
    if row.phone == user.phone:
        raise DomainError("SELF_TRANSFER_NOT_ALLOWED", "That is your own number.")

    # The full number is deliberately NOT returned. The sender already typed it,
    # so echoing it back adds nothing for them -- but returning it would make this
    # a directory that turns any known name into a harvestable phone number.
    return {"name": row.name, "maskedPhone": mask_phone(row.phone)}


@router.get("/users/recent-recipients")
def recent_recipients(
    user: CurrentUser = Depends(current_user), session: Session = Depends(get_session)
):
    rows = session.execute(
        text(
            """
            SELECT DISTINCT ON (u.phone) u.name, u.phone, t.created_at
            FROM transfers t
            JOIN journal_entries je ON je.transfer_id = t.id AND je.amount_poisha > 0
            JOIN accounts a ON a.id = je.account_id
            JOIN users u ON u.id = a.user_id
            WHERE t.sender_account_id = :aid AND u.is_system = FALSE
            ORDER BY u.phone, t.created_at DESC
            """
        ),
        {"aid": user.account_id},
    ).all()

    ordered = sorted(rows, key=lambda r: r.created_at, reverse=True)[:6]
    return {
        "recipients": [
            {"name": r.name, "phone": r.phone, "maskedPhone": mask_phone(r.phone)}
            for r in ordered
        ]
    }
