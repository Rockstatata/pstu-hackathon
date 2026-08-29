import pathlib

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

engine = create_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    # Fail fast when the pool is genuinely saturated. Waiting the 30s default
    # would outlive the gateway's read timeout, so the caller would be told the
    # outcome is unknown for a request that had not yet started.
    pool_timeout=settings.db_pool_timeout_seconds,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)

SCHEMA_PATH = pathlib.Path(__file__).with_name("schema.sql")

# Arbitrary but fixed: all three API replicas contend on this one advisory lock,
# so exactly one applies the schema and the other two wait, then find it applied.
_SCHEMA_LOCK_ID = 728119402


def apply_schema() -> None:
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _SCHEMA_LOCK_ID})
        try:
            # Sent straight to the driver with no parameters, because psycopg only
            # parses %-placeholders when parameters are supplied. The schema
            # contains a plpgsql RAISE with a literal % in its format string, and
            # anything that binds parameters would try to read it as a placeholder.
            conn.connection.driver_connection.execute(SCHEMA_PATH.read_text())
            conn.commit()
        finally:
            # Roll back first. If the apply failed server-side the connection is
            # in an aborted transaction, and the unlock would fail too -- leaving
            # the lock held and the other two replicas blocked forever.
            conn.rollback()
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _SCHEMA_LOCK_ID})
            conn.commit()


def get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def set_lock_timeout(session: Session) -> None:
    """Fail fast rather than hang. ADR-0003: no deadlock retry loop -- deterministic
    lock ordering makes deadlock structurally impossible, so a wait this long means
    something is wrong and we want to hear about it, not paper over it."""
    session.execute(text(f"SET LOCAL lock_timeout = '{settings.lock_timeout_ms}ms'"))
