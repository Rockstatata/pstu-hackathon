import time
import uuid

import bcrypt
import jwt

from .config import settings

# Cost 10, not the library default of 12. A 5-digit PIN has 100k possible values,
# so the cost factor is not what protects it -- the attempt lockout in lockout.py
# is. Cost 12 would make registration the slowest thing in the system under load.
_ROUNDS = 10

# Verified against when no user matches, so an unregistered phone number costs the
# same bcrypt work as a registered one. Without this, response time answers the
# question "is this number registered?" for anyone who cares to measure it.
_ABSENT_USER_HASH = bcrypt.hashpw(b"no-such-user", bcrypt.gensalt(rounds=_ROUNDS)).decode()


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt(rounds=_ROUNDS)).decode()


def verify_pin(pin: str, pin_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode(), pin_hash.encode())
    except ValueError:
        return False


def issue_token(user_id: uuid.UUID) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": now + settings.jwt_ttl_hours * 3600},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str) -> uuid.UUID | None:
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def verify_absent_user(pin: str) -> bool:
    """Burn the same work as a real check, and always fail."""
    verify_pin(pin, _ABSENT_USER_HASH)
    return False
