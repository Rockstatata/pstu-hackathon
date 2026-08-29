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

    cors_origins: str = "http://localhost:3000"

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


settings = Settings()
