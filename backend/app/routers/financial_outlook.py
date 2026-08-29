from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import CurrentUser, current_user
from ..services.financial_outlook import build_financial_outlook


router = APIRouter(tags=["financial-outlook"])


@router.get("/financial-outlook")
def financial_outlook(
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Read-only facts and disclosed assessment bands for this Account."""

    return build_financial_outlook(session, user)
