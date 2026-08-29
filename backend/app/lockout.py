"""Failed-attempt lockout for PIN checks.

A 5-digit PIN has 100,000 possible values. A bcrypt cost factor does not protect
that -- an attacker with unlimited attempts walks the whole space regardless of
how slow each guess is. What protects it is a cap on attempts, which is this file.

Attempts are counted from audit_events rather than from an in-memory counter,
because there are three API replicas: a counter in one process would give an
attacker three times the attempts by spreading them across replicas, and it would
reset on every deploy.

**The counter is keyed on (phone, client address), not on phone alone.** Keying on
the phone would mean five deliberate failures against someone else's number locks
them out of their own money for fifteen minutes -- a denial-of-service any
authenticated user could aim at any other. Scoping by caller means an attacker
only ever locks themselves out, while a single caller is still throttled to five
guesses per window. A distributed attacker gets more attempts than a local one;
that is a real and accepted limit, and it is a far higher bar than the 100,000
unthrottled guesses this replaces.

Letting a correct PIN through while locked would NOT be a safe alternative: an
attacker who sees 429 for a wrong PIN and 200 for a right one can keep guessing
and read the difference, which defeats the cap entirely.
"""

import json
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from .errors import DomainError

MAX_ATTEMPTS = 5
WINDOW_MINUTES = 15

FAILURE_EVENT = "LOGIN_FAILURE"
SUCCESS_EVENT = "LOGIN_SUCCESS"


def subject_for(phone: str, client_ip: str | None) -> str:
    return f"{phone}|{client_ip or 'unknown'}"


def _recent_failures(session: Session, subject: str) -> int:
    """Failures for this subject in the window, counted only since its last success.

    Counting since the last success is what makes a successful sign-in clear the
    slate, so someone who mistypes twice and then gets it right is not locked out
    later by attempts they already recovered from.
    """
    return session.execute(
        text(
            """
            SELECT COUNT(*) FROM audit_events
            WHERE event_type = :fail
              AND metadata_json->>'subject' = :subject
              AND created_at > now() - make_interval(mins => :window)
              AND created_at > COALESCE((
                    SELECT MAX(created_at) FROM audit_events
                    WHERE event_type = :ok
                      AND metadata_json->>'subject' = :subject
              ), 'epoch'::timestamptz)
            """
        ),
        {
            "subject": subject,
            "window": WINDOW_MINUTES,
            "fail": FAILURE_EVENT,
            "ok": SUCCESS_EVENT,
        },
    ).scalar_one()


def guard(session: Session, subject: str) -> None:
    """Refuse further attempts once the cap is reached. Call before checking a PIN."""
    if _recent_failures(session, subject) >= MAX_ATTEMPTS:
        raise DomainError(
            "TOO_MANY_ATTEMPTS",
            f"Too many incorrect attempts. Try again in {WINDOW_MINUTES} minutes.",
            429,
        )


def record(session: Session, subject: str, phone: str, success: bool) -> None:
    """One row per attempt. This is also the LOGIN_FAILURE audit trail the PRD names,
    so the lockout and the audit log are the same record rather than two rows
    describing one event."""
    session.execute(
        text(
            "INSERT INTO audit_events (id, event_type, resource_type, metadata_json) "
            "VALUES (:id, :et, 'auth', CAST(:meta AS jsonb))"
        ),
        {
            "id": uuid.uuid4(),
            "et": SUCCESS_EVENT if success else FAILURE_EVENT,
            "meta": json.dumps({"subject": subject, "phone": phone}),
        },
    )


def attempts_remaining(session: Session, subject: str) -> int:
    return max(0, MAX_ATTEMPTS - _recent_failures(session, subject))
