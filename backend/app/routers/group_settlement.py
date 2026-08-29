import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Header, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from .. import idempotency as idem
from ..db import get_session
from ..deps import CurrentUser, current_user
from ..errors import DomainError
from ..rate_limits import consume as consume_rate_limit
from ..services import group_settlement
from ..validation import normalize_bangladesh_phone, validate_pin

router = APIRouter(prefix="/expense-groups", tags=["expense-groups"])


def _group_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise DomainError("EXPENSE_GROUP_NOT_FOUND", "No expense group found with that ID.", 404) from exc


class CreateGroupBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    member_phones: list[str] = Field(alias="memberPhones", min_length=1, max_length=19)

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Give the Expense Group a name.")
        return value

    @field_validator("member_phones")
    @classmethod
    def valid_phones(cls, values: list[str]) -> list[str]:
        return [normalize_bangladesh_phone(value) for value in values]

    def fingerprint(self) -> dict:
        return {"name": self.name, "memberPhones": sorted(set(self.member_phones))}


class ExactShare(BaseModel):
    user_id: str = Field(alias="userId")
    amount_poisha: int = Field(alias="amountPoisha", gt=0)

    model_config = {"populate_by_name": True, "extra": "forbid"}


class PercentageShare(BaseModel):
    user_id: str = Field(alias="userId")
    percentage_bps: int = Field(alias="percentageBps", gt=0, le=10_000)

    model_config = {"populate_by_name": True, "extra": "forbid"}


class CreateExpenseBody(BaseModel):
    description: str = Field(min_length=1, max_length=140)
    paid_by_user_id: str = Field(alias="paidByUserId")
    total_poisha: int = Field(alias="totalPoisha", gt=0)
    split_type: Literal["EQUAL", "EXACT", "PERCENTAGE"] = Field(alias="splitType")
    participant_user_ids: list[str] | None = Field(default=None, alias="participantUserIds")
    exact_shares: list[ExactShare] | None = Field(default=None, alias="exactShares")
    percentage_shares: list[PercentageShare] | None = Field(default=None, alias="percentageShares")

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Explain what the Expense was for.")
        return value

    @model_validator(mode="after")
    def valid_split_shape(self):
        supplied = sum(
            value is not None
            for value in (self.participant_user_ids, self.exact_shares, self.percentage_shares)
        )
        if supplied != 1:
            raise ValueError("Provide exactly one split definition.")
        if self.split_type == "EQUAL" and not self.participant_user_ids:
            raise ValueError("Equal splits need participantUserIds.")
        if self.split_type == "EXACT" and not self.exact_shares:
            raise ValueError("Exact splits need exactShares.")
        if self.split_type == "PERCENTAGE" and not self.percentage_shares:
            raise ValueError("Percentage splits need percentageShares.")
        return self

    def allocations(self) -> list[tuple[str, int]]:
        if self.split_type == "EQUAL":
            return [(user_id, 0) for user_id in self.participant_user_ids or []]
        if self.split_type == "EXACT":
            return [(share.user_id, share.amount_poisha) for share in self.exact_shares or []]
        return [
            (share.user_id, share.percentage_bps) for share in self.percentage_shares or []
        ]

    def fingerprint(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=True)


class SettleBody(BaseModel):
    plan_version: str = Field(alias="planVersion", min_length=64, max_length=64)
    pin: str | None = None

    model_config = {"populate_by_name": True, "extra": "forbid"}

    @field_validator("pin")
    @classmethod
    def valid_pin(cls, value: str | None) -> str | None:
        return validate_pin(value)

    def fingerprint(self, group_id: uuid.UUID) -> dict:
        return {"groupId": str(group_id), "planVersion": self.plan_version}


def _replay(response: Response, replay: idem.ReplayResult):
    response.status_code = replay.status_code
    response.headers["X-Idempotent-Replay"] = "true"
    return replay.body


@router.post("", status_code=201)
def create_group(
    body: CreateGroupBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    consume_rate_limit("expense_group_create", str(user.user_id), 20)
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request(body.fingerprint())
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        return _replay(response, replay)
    try:
        status, result = group_settlement.create_group(
            session,
            creator_user_id=user.user_id,
            creator_phone=user.phone,
            name=body.name,
            member_phones=body.member_phones,
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


@router.get("")
def list_groups(
    user: CurrentUser = Depends(current_user), session: Session = Depends(get_session)
):
    return group_settlement.list_groups(session, user.user_id)


@router.get("/{group_id}")
def get_group(
    group_id: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return group_settlement.get_group(session, _group_id(group_id), user.user_id)


@router.post("/{group_id}/expenses", status_code=201)
def create_expense(
    group_id: str,
    body: CreateExpenseBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    consume_rate_limit("group_expense_create", str(user.user_id), 60)
    parsed_group_id = _group_id(group_id)
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request(body.fingerprint())
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        return _replay(response, replay)
    try:
        status, result = group_settlement.create_expense(
            session,
            group_id=parsed_group_id,
            actor_user_id=user.user_id,
            paid_by_user_id=body.paid_by_user_id,
            description=body.description,
            total_poisha=body.total_poisha,
            split_type=body.split_type,
            allocations=body.allocations(),
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


@router.get("/{group_id}/settlement-plan")
def get_settlement_plan(
    group_id: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    return group_settlement.settlement_plan(session, _group_id(group_id), user.user_id)


@router.post("/{group_id}/settle", status_code=201)
def settle_group(
    group_id: str,
    body: SettleBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
):
    parsed_group_id = _group_id(group_id)
    key = idem.require_key(idempotency_key)
    request_hash = idem.hash_request(body.fingerprint(parsed_group_id))
    try:
        idem.peek(session, user.user_id, key, request_hash)
    except idem.ReplayResult as replay:
        return _replay(response, replay)
    try:
        status, result = group_settlement.settle_current_user(
            session,
            group_id=parsed_group_id,
            payer_user_id=user.user_id,
            payer_account_id=user.account_id,
            payer_pin_hash=user.pin_hash,
            plan_version=body.plan_version,
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
