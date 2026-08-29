import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import settings
from .db import SessionLocal, apply_schema
from .errors import DomainError, domain_error_handler
from .routers import accounts, auth, system, transfers
from .services import ledger

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
    yield


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
async def attach_trace_id(request: Request, call_next):
    trace_id = request.headers.get("X-Trace-Id") or uuid.uuid4().hex[:16]
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    response.headers["X-Instance"] = settings.instance_id
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


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception):
    """Never send a stack trace to a client."""
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Something went wrong on our side. No money was moved.",
                "traceId": getattr(request.state, "trace_id", "-"),
            }
        },
    )


for r in (auth.router, accounts.router, transfers.router, system.router):
    app.include_router(r, prefix="/api/v1")
