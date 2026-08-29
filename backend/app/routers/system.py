import time

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_session
from ..services import integrity

router = APIRouter(tags=["system"])

STARTED_AT = time.time()


@router.get("/health/live")
def liveness():
    """Is this process running? Deliberately does not touch the database.

    A liveness probe that fails when Postgres is down would have the orchestrator
    restart three healthy API replicas during a database blip, turning one outage
    into two.
    """
    return {"status": "alive", "instance": settings.instance_id}


@router.get("/health/ready")
def readiness(response: Response, session: Session = Depends(get_session)):
    """Can this replica actually serve money movement? That means the database."""
    try:
        session.execute(text("SELECT 1"))
        return {
            "status": "ready",
            "instance": settings.instance_id,
            "uptimeSeconds": round(time.time() - STARTED_AT, 1),
        }
    except Exception:
        response.status_code = 503
        return {
            "status": "not_ready",
            "instance": settings.instance_id,
            "reason": "Cannot reach the financial core.",
        }


@router.get("/integrity")
def integrity_report(session: Session = Depends(get_session)):
    """Unauthenticated on purpose.

    This is the judge-facing screen, it exposes no personal data and no balances
    belonging to any named person, and requiring a login to view it would mean the
    proof is only available to someone who already trusts us enough to sign in.
    """
    report = integrity.run(session)
    report["instance"] = settings.instance_id
    return report


@router.get("/system-info")
def system_info(session: Session = Depends(get_session)):
    replicas = session.execute(
        text(
            """
            SELECT metadata_json->>'instance' AS instance, MAX(created_at) AS last_seen
            FROM audit_events
            WHERE event_type = 'REPLICA_STARTED'
            GROUP BY 1 ORDER BY 2 DESC
            """
        )
    ).all()

    return {
        "instance": settings.instance_id,
        "policy": {
            "maxTransferPoisha": settings.max_transfer_poisha,
            "maxDailySendPoisha": settings.max_daily_send_poisha,
            "maxGroupRecipients": settings.max_group_recipients,
            "stepUpAmountPoisha": settings.stepup_amount_poisha,
            "stepUpVelocityCount": settings.stepup_velocity_count,
            "stepUpVelocityMinutes": settings.stepup_velocity_minutes,
            "lockTimeoutMs": settings.lock_timeout_ms,
        },
        "replicas": [
            {"instance": r.instance, "lastSeen": r.last_seen.isoformat()} for r in replicas
        ],
    }
