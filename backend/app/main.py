import asyncio
import json
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .config import settings
from .db import SessionLocal, apply_schema
from .errors import DomainError, domain_error_handler
from .routers import accounts, auth, group_settlement, money_requests, notifications, scheduled_transfers, smart_wallet, system, transfers
from .services import heartbeats, ledger

ISSUANCE_PHONE = "00000000000"


def bootstrap() -> None:
    """Apply the schema and make sure the single Issuance Account exists.

    All three replicas run this. The schema is applied under an advisory lock, and
    the issuance account is created with ON CONFLICT DO NOTHING plus a partial
    unique index, so the race between replicas has exactly one winner and the
    losers do not error.
    """
    apply_schema()

    with SessionLocal() as session:
        session.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash, is_system) "
                "VALUES (:id, :phone, 'System Issuance', 'x', TRUE) "
                "ON CONFLICT (phone) DO NOTHING"
            ),
            {"id": uuid.uuid4(), "phone": ISSUANCE_PHONE},
        )
        session.execute(
            text(
                "INSERT INTO accounts (id, user_id, kind) "
                "SELECT :id, u.id, 'ISSUANCE' FROM users u WHERE u.phone = :phone "
                "ON CONFLICT DO NOTHING"
            ),
            {"id": uuid.uuid4(), "phone": ISSUANCE_PHONE},
        )
        ledger.audit(
            session,
            "REPLICA_STARTED",
            resource_type="system",
            metadata={"instance": settings.instance_id},
        )
        session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap()
    heartbeats.beat()

    async def heartbeat_loop():
        while True:
            await asyncio.sleep(settings.heartbeat_interval_seconds)
            try:
                await asyncio.to_thread(heartbeats.beat)
            except Exception:
                # A heartbeat outage must not crash an otherwise healthy process.
                # Readiness and /system-info expose the database failure directly.
                pass

    task = asyncio.create_task(heartbeat_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Money Movement",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    # Named explicitly rather than "*": a browser silently drops an
    # Idempotency-Key header the server did not say it would accept, and the
    # request then looks like a first submission every time.
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    expose_headers=["X-Served-By", "X-Idempotent-Replay", "X-Trace-Id", "X-Instance"],
)


@app.middleware("http")
async def request_boundary(request: Request, call_next):
    started = time.perf_counter()
    supplied_trace = request.headers.get("X-Trace-Id", "")
    trace_id = (
        supplied_trace
        if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", supplied_trace)
        else uuid.uuid4().hex[:16]
    )
    request.state.trace_id = trace_id
    request.state.result = "SUCCESS"

    if request.method in {"POST", "PUT", "PATCH"}:
        content_length = request.headers.get("Content-Length")
        if content_length and content_length.isdigit():
            if int(content_length) > settings.max_request_body_bytes:
                request.state.result = "PAYLOAD_TOO_LARGE"
                response = JSONResponse(
                    status_code=413,
                    content={
                        "error": {
                            "code": "PAYLOAD_TOO_LARGE",
                            "message": "Request bodies may be at most 32 KiB.",
                            "traceId": trace_id,
                        }
                    },
                )
                return _finish_request(request, response, started)

        body = await request.body()
        if len(body) > settings.max_request_body_bytes:
            request.state.result = "PAYLOAD_TOO_LARGE"
            response = JSONResponse(
                status_code=413,
                content={
                    "error": {
                        "code": "PAYLOAD_TOO_LARGE",
                        "message": "Request bodies may be at most 32 KiB.",
                        "traceId": trace_id,
                    }
                },
            )
            return _finish_request(request, response, started)

        delivered = False

        async def receive_body():
            nonlocal delivered
            if delivered:
                return {"type": "http.request", "body": b"", "more_body": False}
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive_body

    response = await call_next(request)
    return _finish_request(request, response, started)


def _finish_request(request: Request, response, started: float):
    trace_id = request.state.trace_id
    response.headers["X-Trace-Id"] = trace_id
    response.headers["X-Instance"] = settings.instance_id
    print(
        json.dumps(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "INFO" if response.status_code < 500 else "ERROR",
                "instance": settings.instance_id,
                "trace": trace_id,
                "authenticatedUserId": getattr(
                    request.state, "authenticated_user_id", None
                ),
                "operation": f"{request.method} {request.url.path}",
                "status": response.status_code,
                "result": getattr(request.state, "result", "SUCCESS"),
                "latencyMs": round((time.perf_counter() - started) * 1000, 2),
            },
            separators=(",", ":"),
        ),
        flush=True,
    )
    return response


app.add_exception_handler(DomainError, domain_error_handler)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """Errors are sentences.

    Pydantic's raw output is a nested structure naming internal field paths. The
    first message is usually the one a person needs, so that is what we send.
    """
    detail = "Check the details you entered."
    for err in exc.errors():
        msg = err.get("msg", "")
        if msg.startswith("Value error, "):
            detail = msg.removeprefix("Value error, ")
            break
        if msg:
            field = err.get("loc", ["field"])[-1]
            detail = f"{field}: {msg}"
            break

    request.state.result = "INVALID_REQUEST"
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "INVALID_REQUEST",
                "message": detail,
                "traceId": getattr(request.state, "trace_id", "-"),
            }
        },
    )


@app.exception_handler(SQLAlchemyError)
async def database_error_handler(request: Request, exc: SQLAlchemyError):
    """Commit failures are uncertain: direct retries must reuse the same key."""
    request.state.result = "FINANCIAL_CORE_UNAVAILABLE"
    return JSONResponse(
        status_code=503,
        content={
            "error": {
                "code": "FINANCIAL_CORE_UNAVAILABLE",
                "message": (
                    "The financial core is unavailable. The outcome may be unknown; "
                    "check history before retrying with the same Idempotency-Key."
                ),
                "traceId": getattr(request.state, "trace_id", "-"),
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception):
    """Never send a stack trace or make an unsafe outcome claim to a client."""
    request.state.result = "INTERNAL_ERROR"
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Something went wrong. Check your history before trying again.",
                "traceId": getattr(request.state, "trace_id", "-"),
            }
        },
    )


for r in (
    auth.router,
    accounts.router,
    transfers.router,
    money_requests.router,
    group_settlement.router,
    notifications.router,
    scheduled_transfers.router,
    smart_wallet.router,
    system.router,
):
    app.include_router(r, prefix="/api/v1")
