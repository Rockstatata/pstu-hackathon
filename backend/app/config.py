import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://money:money@db:5432/money"
    jwt_secret: str = "dev-secret-not-for-production"
    jwt_algorithm: str = "HS256"
    jwt_ttl_hours: int = 12

    # Pathological lock waits should fail fast rather than hang a request.
    # See docs/adr/0003 — we prevent deadlock by lock ordering, and this is
    # the backstop that keeps a stuck transaction from holding a worker.
    lock_timeout_ms: int = 3000

    # Connection pool, sized against the request thread pool rather than guessed.
    # A rate-limited endpoint holds its request session AND opens a second one
    # for the counter, so worst case is two connections per in-flight request.
    # request_threadpool_size * 2 <= db_pool_size + db_max_overflow keeps pool
    # exhaustion structurally impossible instead of merely unlikely.
    # 3 replicas * 40 + the scheduler stays well inside PostgreSQL's 200.
    db_pool_size: int = 20
    db_max_overflow: int = 20
    # Deliberately shorter than nginx's 15s proxy_read_timeout. SQLAlchemy's 30s
    # default would have the gateway give up first, so the caller would see a
    # 503 for a request the API was still holding in a queue -- an uncertain
    # outcome manufactured by our own timeout ordering.
    db_pool_timeout_seconds: int = 5
    # Starlette runs sync endpoints on anyio's thread pool, whose default of 40
    # is larger than the connection pool above. Bounded here so the limit is the
    # pool we sized, not a framework default we did not choose.
    request_threadpool_size: int = 20

    cors_origins: str = "http://localhost:3000"
    app_environment: str = "development"
    max_request_body_bytes: int = 32 * 1024
    expected_replicas: int = 3
    heartbeat_interval_seconds: int = 5
    heartbeat_freshness_seconds: int = 15
    chaos_enabled: bool = False
    trusted_proxy_cidrs: str = "127.0.0.1/32,::1/128,172.16.0.0/12"

    # Which API replica this process is. Docker sets HOSTNAME to the container
    # id, which is what the integrity dashboard shows as a per-instance dot.
    instance_id: str = Field(default_factory=lambda: os.getenv("HOSTNAME", "local"))

    # Every user is funded this much at registration, debited from the
    # issuance account so the ledger still sums to zero.
    signup_grant_poisha: int = 100_000_00

    # Transfer Policy limits (see CONTEXT.md).
    max_transfer_poisha: int = 100_000_00
    max_daily_send_poisha: int = 200_000_00
    max_group_recipients: int = 20

    # Step-Up thresholds (docs/adr/0006 — deterministic, never a model).
    stepup_amount_poisha: int = 25_000_00
    stepup_velocity_count: int = 5
    stepup_velocity_minutes: int = 10

    money_request_ttl_hours: int = 24

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def trusted_proxy_cidr_list(self) -> list[str]:
        return [value.strip() for value in self.trusted_proxy_cidrs.split(",") if value.strip()]


settings = Settings()
