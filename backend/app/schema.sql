-- Money Movement schema. Re-runnable; applied at API startup under an advisory lock.
-- Money is BIGINT poisha everywhere. 1 taka = 100 poisha. No floats, ever.

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY,
    phone       VARCHAR(20)  NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL,
    pin_hash    TEXT         NOT NULL,
    is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY,
    user_id         UUID        NOT NULL UNIQUE REFERENCES users(id),
    kind            VARCHAR(16) NOT NULL DEFAULT 'USER',
    currency        CHAR(3)     NOT NULL DEFAULT 'BDT',
    balance_poisha  BIGINT      NOT NULL DEFAULT 0,
    status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The no-negative-balance invariant, enforced by the database itself and not
    -- only by application code. The issuance Account is the deliberate exception:
    -- it goes negative by exactly the amount issued, which is what makes the
    -- system-wide sum zero.
    CONSTRAINT accounts_no_negative_balance
        CHECK (kind = 'ISSUANCE' OR balance_poisha >= 0),
    CONSTRAINT accounts_kind_valid
        CHECK (kind IN ('USER', 'ISSUANCE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_single_issuance
    ON accounts ((kind)) WHERE kind = 'ISSUANCE';

CREATE TABLE IF NOT EXISTS transfers (
    id                    UUID PRIMARY KEY,
    public_reference      VARCHAR(32)  NOT NULL UNIQUE,
    kind                  VARCHAR(16)  NOT NULL,
    sender_account_id     UUID         NOT NULL REFERENCES accounts(id),
    total_poisha          BIGINT       NOT NULL,
    note                  VARCHAR(140),
    status                VARCHAR(16)  NOT NULL DEFAULT 'COMPLETED',
    risk_decision         VARCHAR(16),
    risk_reason           VARCHAR(120),
    reversal_of           UUID         REFERENCES transfers(id),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT transfers_positive_amount CHECK (total_poisha > 0),
    CONSTRAINT transfers_kind_valid
        CHECK (kind IN ('ISSUANCE', 'P2P', 'GROUP', 'REVERSAL'))
);

CREATE INDEX IF NOT EXISTS transfers_sender_idx ON transfers (sender_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_reversal_idx ON transfers (reversal_of) WHERE reversal_of IS NOT NULL;

-- One immutable half of a money movement. amount_poisha is SIGNED:
-- negative = debit, positive = credit. A single signed column means
-- "does the Ledger sum to zero?" is one SUM() with nothing to reconcile
-- between a direction flag and a magnitude.
CREATE TABLE IF NOT EXISTS journal_entries (
    id             UUID PRIMARY KEY,
    transfer_id    UUID   NOT NULL REFERENCES transfers(id),
    account_id     UUID   NOT NULL REFERENCES accounts(id),
    amount_poisha  BIGINT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT journal_entries_nonzero CHECK (amount_poisha <> 0)
);

CREATE INDEX IF NOT EXISTS journal_account_idx ON journal_entries (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS journal_transfer_idx ON journal_entries (transfer_id);

-- Journal Entries are append-only. This is not a convention we hope the code
-- honours; the database raises on any UPDATE or DELETE. It raises rather than
-- silently ignoring, so a bug that tries to rewrite history fails loudly.
CREATE OR REPLACE FUNCTION journal_entries_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'journal_entries is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entries_append_only_trg ON journal_entries;
CREATE TRIGGER journal_entries_append_only_trg
    BEFORE UPDATE OR DELETE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION journal_entries_append_only();

CREATE TABLE IF NOT EXISTS idempotency_records (
    id              UUID PRIMARY KEY,
    user_id         UUID        NOT NULL REFERENCES users(id),
    idempotency_key VARCHAR(80) NOT NULL,
    request_hash    CHAR(64)    NOT NULL,
    resource_type   VARCHAR(32) NOT NULL,
    resource_id     UUID,
    status_code     INTEGER,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT idempotency_unique_per_user UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id             UUID PRIMARY KEY,
    event_type     VARCHAR(48) NOT NULL,
    actor_user_id  UUID,
    resource_type  VARCHAR(32),
    resource_id    UUID,
    metadata_json  JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_type_idx ON audit_events (event_type, created_at DESC);

-- The lockout check runs on every login and filters on a JSON key, which
-- audit_type_idx cannot serve. audit_events is the highest-volume table in the
-- system, so without this the sign-in path degrades as the demo runs.
CREATE INDEX IF NOT EXISTS audit_auth_subject_idx
    ON audit_events ((metadata_json->>'subject'), created_at DESC)
    WHERE event_type IN ('LOGIN_FAILURE', 'LOGIN_SUCCESS');
