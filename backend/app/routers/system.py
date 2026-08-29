import time

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_session
from ..services import integrity, system_metrics

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


@router.get("/system-metrics")
def system_metrics_report(session: Session = Depends(get_session)):
    """Load, concurrency and database behaviour, read live like /integrity.

    Unauthenticated for the same reason: it is the screen a sceptic is invited to
    watch while someone else moves money, and it names no person, no phone number
    and no individual balance. Everything here is a PostgreSQL read at the moment
    of the call, except the latency block, which is this replica's own recent
    requests and is labelled with its instance id.
    """
    return system_metrics.run(session)


@router.get("/system-info")
def system_info(session: Session = Depends(get_session)):
    replicas = session.execute(
        text(
            """
            SELECT instance_id AS instance, started_at, last_seen_at,
                   last_seen_at > now() - make_interval(secs => :freshness) AS healthy
            FROM replica_heartbeats
            ORDER BY last_seen_at DESC
            """
        ),
        {"freshness": settings.heartbeat_freshness_seconds},
    ).all()
    healthy_count = sum(1 for replica in replicas if replica.healthy)

    return {
        "instance": settings.instance_id,
        "health": "HEALTHY" if healthy_count == settings.expected_replicas else "DEGRADED",
        "expectedReplicas": settings.expected_replicas,
        "healthyReplicas": healthy_count,
        "freshnessWindowSeconds": settings.heartbeat_freshness_seconds,
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
            {
                "instance": r.instance,
                "startedAt": r.started_at.isoformat(),
                "lastSeen": r.last_seen_at.isoformat(),
                "healthy": r.healthy,
            }
            for r in replicas
        ],
    }
