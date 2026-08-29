import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from .. import idempotency as idem
from ..db import get_session
from ..deps import CurrentUser, current_user
from ..errors import DomainError
from ..rate_limits import consume as consume_rate_limit
from ..services import money_requests
from ..validation import normalize_bangladesh_phone, validate_pin

router = APIRouter(prefix="/money-requests", tags=["money-requests"])

def _request_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise DomainError(
            "MONEY_REQUEST_NOT_FOUND", "No money request found with that ID.", 404
        ) from exc


class CreateMoneyRequestBody(BaseModel):
    payer_phone: str = Field(alias="payerPhone")
    amount_poisha: int = Field(alias="amountPoisha", gt=0)
    reason: str = Field(min_length=1, max_length=140)

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @field_validator("payer_phone")
    @classmethod
    def valid_phone(cls, value: str) -> str:
        return normalize_bangladesh_phone(value)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Explain what this request is for.")
        return value

    def fingerprint(self) -> dict:
        return {
            "payerPhone": self.payer_phone,
            "amountPoisha": self.amount_poisha,
            "reason": self.reason,
        }


class PayMoneyRequestBody(BaseModel):
    pin: str | None = Field(default=None, min_length=5, max_length=5)

    model_config = {"extra": "forbid"}

    @field_validator("pin")
    @classmethod
    def numeric_pin(cls, value: str | None) -> str | None:
        return validate_pin(value)


class SafeIdentity(BaseModel):
    name: str
    masked_phone: str = Field(alias="maskedPhone")

    model_config = {"populate_by_name": True}


class MoneyRequestResource(BaseModel):
    request_id: str = Field(alias="requestId")
    reference: str
    direction: Literal["incoming", "outgoing"]
    status: Literal["PENDING", "PAID", "DECLINED", "CANCELLED", "EXPIRED"]
    amount_poisha: int = Field(alias="amountPoisha")
    reason: str
    requester: SafeIdentity
    payer: SafeIdentity
    transfer_reference: str | None = Field(alias="transferReference")
    created_at: datetime = Field(alias="createdAt")
    expires_at: datetime = Field(alias="expiresAt")
    resolved_at: datetime | None = Field(alias="resolvedAt")

    model_config = {"populate_by_name": True}


class MoneyRequestList(BaseModel):
    money_requests: list[MoneyRequestResource] = Field(alias="moneyRequests")

    model_config = {"populate_by_name": True}


class ReceiptRecipient(BaseModel):
    name: str
    masked_phone: str = Field(alias="maskedPhone")
    amount_poisha: int = Field(alias="amountPoisha")

    model_config = {"populate_by_name": True}


class MoneyRequestPaymentReceipt(BaseModel):
    transfer_id: str = Field(alias="transferId")
    reference: str
    kind: Literal["P2P"]
    status: Literal["COMPLETED"]
    total_poisha: int = Field(alias="totalPoisha")
    note: str | None
    risk_reason: str | None = Field(alias="riskReason")
    sender_balance_after_poisha: int = Field(alias="senderBalanceAfterPoisha")
    completed_at: datetime = Field(alias="completedAt")
    recipients: list[ReceiptRecipient]
    money_request_id: str = Field(alias="moneyRequestId")
    money_request_reference: str = Field(alias="moneyRequestReference")

    model_config = {"populate_by_name": True}


def _replay(response: Response, replay: idem.ReplayResult):
    response.status_code = replay.status_code
    response.headers["X-Idempotent-Replay"] = "true"
    return replay.body


@router.post("", status_code=201, response_model=MoneyRequestResource)
def create_money_request(
    body: CreateMoneyRequestBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    consume_rate_limit("money_request_create", str(user.user_id), 20)
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request(body.fingerprint())
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        return _replay(response, replay)

    try:
        status, result = money_requests.create(
            session,
            requester_user_id=user.user_id,
            requester_account_id=user.account_id,
            payer_phone=body.payer_phone,
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


@router.get("", response_model=MoneyRequestList)
def list_money_requests(
    direction: Literal["incoming", "outgoing"] = "incoming",
    status: Literal["PENDING", "PAID", "DECLINED", "CANCELLED", "EXPIRED"] | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return money_requests.list_for_account(
        session,
        viewer_account_id=user.account_id,
        direction=direction,
        status=status,
        limit=limit,
    )


@router.get("/{request_id}", response_model=MoneyRequestResource)
def get_money_request(
    request_id: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return money_requests.get(session, _request_id(request_id), user.account_id)


@router.post(
    "/{request_id}/pay", status_code=201, response_model=MoneyRequestPaymentReceipt
)
def pay_money_request(
    request_id: str,
    body: PayMoneyRequestBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    parsed_id = _request_id(request_id)
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request({"moneyRequestId": str(parsed_id)})
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        return _replay(response, replay)

    try:
        status, result = money_requests.pay(
            session,
            request_id=parsed_id,
            payer_user_id=user.user_id,
            payer_account_id=user.account_id,
            payer_pin_hash=user.pin_hash,
            pin=body.pin,
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


@router.post("/{request_id}/decline", response_model=MoneyRequestResource)
def decline_money_request(
    request_id: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    try:
        result = money_requests.transition(
            session,
            request_id=_request_id(request_id),
            actor_user_id=user.user_id,
            actor_account_id=user.account_id,
            action="DECLINED",
        )
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


@router.post("/{request_id}/cancel", response_model=MoneyRequestResource)
def cancel_money_request(
    request_id: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    try:
        result = money_requests.transition(
            session,
            request_id=_request_id(request_id),
            actor_user_id=user.user_id,
            actor_account_id=user.account_id,
            action="CANCELLED",
        )
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise
