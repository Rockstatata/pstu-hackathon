import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from .. import idempotency as idem
from ..db import get_session
from ..deps import CurrentUser, current_user
from ..errors import DomainError
from ..rate_limits import consume as consume_rate_limit
from ..services import scheduled_transfers
from ..validation import normalize_bangladesh_phone, validate_pin

router = APIRouter(prefix="/scheduled-transfers", tags=["scheduled-transfers"])


def _schedule_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise DomainError(
            "SCHEDULED_TRANSFER_NOT_FOUND", "No Scheduled Transfer found with that ID.", 404
        ) from exc


class ScheduledRecipient(BaseModel):
    name: str
    masked_phone: str = Field(alias="maskedPhone")

    model_config = {"populate_by_name": True}


class ScheduledTransferResource(BaseModel):
    scheduled_transfer_id: str = Field(alias="scheduledTransferId")
    reference: str
    status: Literal["SCHEDULED", "EXECUTED", "FAILED", "CANCELLED"]
    amount_poisha: int = Field(alias="amountPoisha")
    note: str | None
    execute_at: datetime = Field(alias="executeAt")
    recipient: ScheduledRecipient
    transfer_reference: str | None = Field(alias="transferReference")
    failure_code: str | None = Field(alias="failureCode")
    failure_message: str | None = Field(alias="failureMessage")
    authorized_at: datetime = Field(alias="authorizedAt")
    resolved_at: datetime | None = Field(alias="resolvedAt")
    created_at: datetime = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class ScheduledTransferList(BaseModel):
    scheduled_transfers: list[ScheduledTransferResource] = Field(alias="scheduledTransfers")

    model_config = {"populate_by_name": True}


class CreateScheduledTransferBody(BaseModel):
    recipient_phone: str = Field(alias="recipientPhone")
    amount_poisha: int = Field(alias="amountPoisha", gt=0)
    execute_at: datetime = Field(alias="executeAt")
    note: str | None = Field(default=None, max_length=140)
    pin: str | None = None

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @field_validator("recipient_phone")
    @classmethod
    def valid_phone(cls, value: str) -> str:
        return normalize_bangladesh_phone(value)

    @field_validator("execute_at")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Date and time must include a timezone.")
        return value

    @field_validator("note")
    @classmethod
    def clean_note(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("pin")
    @classmethod
    def valid_pin(cls, value: str | None) -> str | None:
        return validate_pin(value)

    def fingerprint(self) -> dict:
        return {
            "recipientPhone": self.recipient_phone,
            "amountPoisha": self.amount_poisha,
            "executeAt": self.execute_at.isoformat(),
            "note": self.note,
        }


@router.post("", status_code=201, response_model=ScheduledTransferResource)
def create_scheduled_transfer(
    body: CreateScheduledTransferBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    consume_rate_limit("scheduled_transfer_create", str(user.user_id), 20)
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request(body.fingerprint())
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        response.status_code = replay.status_code
        response.headers["X-Idempotent-Replay"] = "true"
        return replay.body

    try:
        status, result = scheduled_transfers.create(
            session,
            creator_user_id=user.user_id,
            sender_account_id=user.account_id,
            sender_pin_hash=user.pin_hash,
            recipient_phone=body.recipient_phone,
            amount_poisha=body.amount_poisha,
            note=body.note,
            execute_at=body.execute_at,
            pin=body.pin,
            idempotency_key=key,
            request_hash=request_hash,
        )
        session.commit()
    except idem.ReplayResult as replay:
        session.rollback()
        response.status_code = replay.status_code
        response.headers["X-Idempotent-Replay"] = "true"
        return replay.body
    except Exception:
        session.rollback()
        raise

    response.status_code = status
    response.headers["X-Idempotent-Replay"] = "false"
    return result


@router.get("", response_model=ScheduledTransferList)
def list_scheduled_transfers(
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return scheduled_transfers.list_for_user(session, user_id=user.user_id)


@router.get("/{schedule_id}", response_model=ScheduledTransferResource)
def get_scheduled_transfer(
    schedule_id: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return scheduled_transfers._resource(
        scheduled_transfers.get(
            session, schedule_id=_schedule_id(schedule_id), user_id=user.user_id
        )
    )


@router.post("/{schedule_id}/cancel", response_model=ScheduledTransferResource)
def cancel_scheduled_transfer(
    schedule_id: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    try:
        result = scheduled_transfers.cancel(
            session, schedule_id=_schedule_id(schedule_id), user_id=user.user_id
        )
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise
