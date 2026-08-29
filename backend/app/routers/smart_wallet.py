from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from .. import idempotency as idem
from ..db import get_session
from ..deps import CurrentUser, current_user
from ..rate_limits import consume as consume_rate_limit
from ..services import smart_wallet

router = APIRouter(prefix="/smart-wallet", tags=["smart-wallet"])


class CashEventResource(BaseModel):
    event_id: str = Field(alias="eventId")
    sequence_number: int = Field(alias="sequenceNumber")
    kind: Literal["CASH_IN", "CASH_OUT", "RECONCILIATION"]
    amount_poisha: int = Field(alias="amountPoisha")
    expected_before_poisha: int = Field(alias="expectedBeforePoisha")
    expected_after_poisha: int = Field(alias="expectedAfterPoisha")
    counted_cash_poisha: int | None = Field(alias="countedCashPoisha")
    source: Literal["SIMULATOR", "DEVICE", "USER"]
    reason: str | None
    observed_at: datetime = Field(alias="observedAt")
    recorded_at: datetime = Field(alias="recordedAt")

    model_config = {"populate_by_name": True}


class SmartWalletResource(BaseModel):
    wallet_id: str = Field(alias="walletId")
    connection_status: Literal["CONNECTED", "DISCONNECTED"] = Field(alias="connectionStatus")
    expected_cash_poisha: int = Field(alias="expectedCashPoisha")
    last_sequence: int = Field(alias="lastSequence")
    last_synced_at: datetime | None = Field(alias="lastSyncedAt")
    inventory_difference_poisha: int = Field(alias="inventoryDifferencePoisha")
    activity: list[CashEventResource]

    model_config = {"populate_by_name": True}


class CashMutationResource(BaseModel):
    event: CashEventResource
    wallet: SmartWalletResource


class ConnectionBody(BaseModel):
    connected: bool

    model_config = {"extra": "forbid"}


class CashObservationBody(BaseModel):
    kind: Literal["CASH_IN", "CASH_OUT"]
    amount_poisha: int = Field(alias="amountPoisha", gt=0)
    reason: str | None = Field(default=None, max_length=140)

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    def fingerprint(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=True)


class ReconciliationBody(BaseModel):
    counted_cash_poisha: int = Field(alias="countedCashPoisha", ge=0)
    reason: str = Field(min_length=1, max_length=140)

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Explain why the counted cash differs.")
        return value

    def fingerprint(self) -> dict:
        return self.model_dump(by_alias=True)


def _replay(response: Response, replay: idem.ReplayResult):
    response.status_code = replay.status_code
    response.headers["X-Idempotent-Replay"] = "true"
    return replay.body


@router.get("", response_model=SmartWalletResource)
def get_smart_wallet(
    limit: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return smart_wallet.get(session, user.user_id, limit=limit)


@router.post("/connection", response_model=SmartWalletResource)
def set_connection(
    body: ConnectionBody,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    try:
        result = smart_wallet.set_connection(
            session, user_id=user.user_id, connected=body.connected
        )
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


@router.post("/events", status_code=201, response_model=CashMutationResource)
def record_cash_event(
    body: CashObservationBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    consume_rate_limit("smart_wallet_event", str(user.user_id), 120)
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request(body.fingerprint())
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        return _replay(response, replay)

    try:
        status, result = smart_wallet.record_observation(
            session,
            user_id=user.user_id,
            kind=body.kind,
            amount_poisha=body.amount_poisha,
            reason=body.reason,
            idempotency_key=key,
            request_hash=request_hash,
        )
        session.commit()
    except idem.ReplayResult as replay:
        session.rollback()
        return _replay(response, replay)
    except Exception:
        session.rollback()
        raise

    response.status_code = status
    response.headers["X-Idempotent-Replay"] = "false"
    return result


@router.post("/reconciliations", status_code=201, response_model=CashMutationResource)
def reconcile_cash(
    body: ReconciliationBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    consume_rate_limit("smart_wallet_reconciliation", str(user.user_id), 30)
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request(body.fingerprint())
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        return _replay(response, replay)

    try:
        status, result = smart_wallet.reconcile(
            session,
            user_id=user.user_id,
            counted_cash_poisha=body.counted_cash_poisha,
            reason=body.reason,
            idempotency_key=key,
            request_hash=request_hash,
        )
        session.commit()
    except idem.ReplayResult as replay:
        session.rollback()
        return _replay(response, replay)
    except Exception:
        session.rollback()
        raise

    response.status_code = status
    response.headers["X-Idempotent-Replay"] = "false"
    return result
