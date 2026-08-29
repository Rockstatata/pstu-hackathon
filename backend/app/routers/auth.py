import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import lockout
from ..config import settings
from ..db import get_session
from ..deps import CurrentUser, current_user
from ..errors import DomainError
from ..network import client_address
from ..rate_limits import consume as consume_rate_limit
from ..security import hash_pin, issue_token, verify_absent_user, verify_pin
from ..services.transfer import issue_registration_grant
from ..validation import normalize_bangladesh_phone, validate_pin

router = APIRouter(prefix="/auth", tags=["auth"])

class Credentials(BaseModel):
    phone: str
    pin: str = Field(min_length=5, max_length=5)

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, v: str) -> str:
        return normalize_bangladesh_phone(v)

    @field_validator("pin")
    @classmethod
    def numeric_pin(cls, v: str) -> str:
        return validate_pin(v) or v


class RegisterBody(Credentials):
    name: str = Field(min_length=2, max_length=120)


@router.post("/register", status_code=201)
def register(body: RegisterBody, session: Session = Depends(get_session)):
    user_id = uuid.uuid4()
    account_id = uuid.uuid4()

    try:
        # Registration and issuance are one transaction. A user that exists without
        # their welcome grant, or a grant without a user, are both states we would
        # then have to reconcile -- so neither is reachable.
        session.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash) VALUES (:id, :phone, :name, :pin)"
            ),
            {"id": user_id, "phone": body.phone, "name": body.name.strip(), "pin": hash_pin(body.pin)},
        )
        session.execute(
            text("INSERT INTO accounts (id, user_id, kind) VALUES (:id, :uid, 'USER')"),
            {"id": account_id, "uid": user_id},
        )
        session.execute(
            text("INSERT INTO smart_wallets (id, user_id) VALUES (:id, :uid)"),
            {"id": user_id, "uid": user_id},
        )
        reference = issue_registration_grant(session, user_id, account_id)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise DomainError(
            "PHONE_ALREADY_REGISTERED",
            "That number already has an account. Sign in instead.",
            409,
        )

    return {
        "token": issue_token(user_id),
        "user": {"id": str(user_id), "name": body.name.strip(), "phone": body.phone},
        "grant": {"amountPoisha": settings.signup_grant_poisha, "reference": reference},
    }


@router.post("/login")
def login(body: Credentials, request: Request, session: Session = Depends(get_session)):
    address = client_address(request)
    consume_rate_limit("login", address, 20)
    subject = lockout.subject_for(body.phone, address)
    lockout.guard(session, subject)

    row = session.execute(
        text("SELECT id, name, phone, pin_hash FROM users WHERE phone = :p AND is_system = FALSE"),
        {"p": body.phone},
    ).one_or_none()

    # Both branches run one bcrypt verification and return the same message, so
    # neither the response body nor the response time reveals whether a number is
    # registered. A short-circuit here would be a user-enumeration oracle.
    ok = verify_pin(body.pin, row.pin_hash) if row is not None else verify_absent_user(body.pin)

    if not ok:
        lockout.record(session, subject, body.phone, success=False)
        session.commit()
        raise DomainError("UNAUTHENTICATED", "That phone number or PIN is not correct.", 401)

    lockout.record(session, subject, body.phone, success=True)
    session.commit()

    return {
        "token": issue_token(row.id),
        "user": {"id": str(row.id), "name": row.name, "phone": row.phone},
    }


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)):
    return {"id": str(user.user_id), "name": user.name, "phone": user.phone}
