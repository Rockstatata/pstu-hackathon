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

-- Physical cash is inventory, not digital money (ADR-0008). One Smart Wallet
-- belongs to one non-system User; its cached expected amount is independently
-- checkable against the append-only Cash Events below.
CREATE TABLE IF NOT EXISTS smart_wallets (
    id                    UUID PRIMARY KEY,
    user_id               UUID        NOT NULL UNIQUE REFERENCES users(id),
    expected_cash_poisha  BIGINT      NOT NULL DEFAULT 0,
    connection_status     VARCHAR(16) NOT NULL DEFAULT 'DISCONNECTED',
    last_sequence         BIGINT      NOT NULL DEFAULT 0,
    last_synced_at        TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT smart_wallets_expected_cash_nonnegative CHECK (expected_cash_poisha >= 0),
    CONSTRAINT smart_wallets_sequence_nonnegative CHECK (last_sequence >= 0),
    CONSTRAINT smart_wallets_connection_valid
        CHECK (connection_status IN ('CONNECTED', 'DISCONNECTED'))
);

-- Existing users predate the Smart Wallet feature. Reusing the User UUID as the
-- one-to-one wallet UUID makes this backfill deterministic and re-runnable.
INSERT INTO smart_wallets (id, user_id)
SELECT id, id FROM users WHERE is_system = FALSE
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cash_events (
    id                       UUID PRIMARY KEY,
    smart_wallet_id          UUID        NOT NULL REFERENCES smart_wallets(id),
    external_event_id        VARCHAR(80) NOT NULL,
    sequence_number          BIGINT      NOT NULL,
    kind                     VARCHAR(24) NOT NULL,
    amount_poisha            BIGINT      NOT NULL,
    expected_before_poisha   BIGINT      NOT NULL,
    expected_after_poisha    BIGINT      NOT NULL,
    counted_cash_poisha      BIGINT,
    source                   VARCHAR(16) NOT NULL,
    reason                   VARCHAR(140),
    observed_at              TIMESTAMPTZ NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cash_events_external_unique UNIQUE (smart_wallet_id, external_event_id),
    CONSTRAINT cash_events_sequence_unique UNIQUE (smart_wallet_id, sequence_number),
    CONSTRAINT cash_events_sequence_positive CHECK (sequence_number > 0),
    CONSTRAINT cash_events_expected_nonnegative
        CHECK (expected_before_poisha >= 0 AND expected_after_poisha >= 0),
    CONSTRAINT cash_events_kind_valid
        CHECK (kind IN ('CASH_IN', 'CASH_OUT', 'RECONCILIATION')),
    CONSTRAINT cash_events_source_valid
        CHECK (source IN ('SIMULATOR', 'DEVICE', 'USER')),
    CONSTRAINT cash_events_shape_valid CHECK (
        (kind = 'CASH_IN' AND amount_poisha > 0 AND counted_cash_poisha IS NULL
            AND source IN ('SIMULATOR', 'DEVICE'))
        OR (kind = 'CASH_OUT' AND amount_poisha < 0 AND counted_cash_poisha IS NULL
            AND source IN ('SIMULATOR', 'DEVICE'))
        OR (kind = 'RECONCILIATION' AND counted_cash_poisha IS NOT NULL
            AND counted_cash_poisha >= 0 AND source = 'USER'
            AND amount_poisha = counted_cash_poisha - expected_before_poisha)
    ),
    CONSTRAINT cash_events_projection_consistent
        CHECK (expected_after_poisha = expected_before_poisha + amount_poisha)
);

CREATE INDEX IF NOT EXISTS cash_events_wallet_history_idx
    ON cash_events (smart_wallet_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION cash_events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'cash_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_events_append_only_trg ON cash_events;
CREATE TRIGGER cash_events_append_only_trg
    BEFORE UPDATE OR DELETE ON cash_events
    FOR EACH ROW EXECUTE FUNCTION cash_events_append_only();

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

-- The operations console reads throughput as transfers per minute over the last
-- hour, which filters on created_at alone. transfers_sender_idx is prefixed by
-- sender_account_id and cannot serve that, so the console would seq-scan the
-- whole table every five seconds while the load test it is measuring runs.
CREATE INDEX IF NOT EXISTS transfers_created_at_idx ON transfers (created_at DESC);

-- A Scheduled Transfer is a future instruction, never a Transfer or Journal
-- Entry before execution (ADR-0010). A due row is claimed with FOR UPDATE SKIP
-- LOCKED and the resulting Transfer link is committed in the same transaction.
CREATE TABLE IF NOT EXISTS scheduled_transfers (
    id                    UUID         PRIMARY KEY,
    public_reference      VARCHAR(32)  NOT NULL UNIQUE,
    creator_user_id       UUID         NOT NULL REFERENCES users(id),
    sender_account_id     UUID         NOT NULL REFERENCES accounts(id),
    recipient_account_id  UUID         NOT NULL REFERENCES accounts(id),
    amount_poisha         BIGINT       NOT NULL,
    note                  VARCHAR(140),
    execute_at            TIMESTAMPTZ  NOT NULL,
    status                VARCHAR(16)  NOT NULL DEFAULT 'SCHEDULED',
    transfer_id           UUID         UNIQUE REFERENCES transfers(id),
    failure_code          VARCHAR(48),
    failure_message       VARCHAR(240),
    authorized_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT scheduled_transfers_positive_amount CHECK (amount_poisha > 0),
    CONSTRAINT scheduled_transfers_not_self CHECK (sender_account_id <> recipient_account_id),
    CONSTRAINT scheduled_transfers_status_valid
        CHECK (status IN ('SCHEDULED', 'EXECUTED', 'FAILED', 'CANCELLED')),
    CONSTRAINT scheduled_transfers_state_consistent CHECK (
        (status = 'SCHEDULED' AND transfer_id IS NULL AND resolved_at IS NULL
            AND failure_code IS NULL AND failure_message IS NULL)
        OR (status = 'EXECUTED' AND transfer_id IS NOT NULL AND resolved_at IS NOT NULL
            AND failure_code IS NULL AND failure_message IS NULL)
        OR (status IN ('FAILED', 'CANCELLED') AND transfer_id IS NULL
            AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS scheduled_transfers_user_history_idx
    ON scheduled_transfers (creator_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS scheduled_transfers_due_idx
    ON scheduled_transfers (execute_at, id) WHERE status = 'SCHEDULED';
CREATE INDEX IF NOT EXISTS scheduled_transfers_sender_idx
    ON scheduled_transfers (sender_account_id);
CREATE INDEX IF NOT EXISTS scheduled_transfers_recipient_idx
    ON scheduled_transfers (recipient_account_id);

-- A Money Request is an intention, never a movement of money. Only PAYING it
-- creates a Transfer, and that link is unique so one request can never settle
-- through two different Transfers. EXPIRED is derived for pending rows whose
-- expires_at has passed; terminal business decisions are stored explicitly.
CREATE TABLE IF NOT EXISTS money_requests (
    id                    UUID PRIMARY KEY,
    public_reference      VARCHAR(32)  NOT NULL UNIQUE,
    requester_account_id  UUID         NOT NULL REFERENCES accounts(id),
    payer_account_id      UUID         NOT NULL REFERENCES accounts(id),
    amount_poisha         BIGINT       NOT NULL,
    reason                VARCHAR(140) NOT NULL,
    status                VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    transfer_id           UUID         UNIQUE REFERENCES transfers(id),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ  NOT NULL DEFAULT (now() + interval '24 hours'),
    resolved_at           TIMESTAMPTZ,

    CONSTRAINT money_requests_positive_amount CHECK (amount_poisha > 0),
    CONSTRAINT money_requests_distinct_accounts
        CHECK (requester_account_id <> payer_account_id),
    CONSTRAINT money_requests_status_valid
        CHECK (status IN ('PENDING', 'PAID', 'DECLINED', 'CANCELLED')),
    CONSTRAINT money_requests_resolution_consistent CHECK (
        (status = 'PENDING' AND transfer_id IS NULL AND resolved_at IS NULL)
        OR (status = 'PAID' AND transfer_id IS NOT NULL AND resolved_at IS NOT NULL)
        OR (status IN ('DECLINED', 'CANCELLED') AND transfer_id IS NULL AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS money_requests_requester_idx
    ON money_requests (requester_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS money_requests_payer_idx
    ON money_requests (payer_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS money_requests_pending_expiry_idx
    ON money_requests (expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS money_requests_transfer_idx
    ON money_requests (transfer_id) WHERE transfer_id IS NOT NULL;

ALTER TABLE money_requests
    ADD COLUMN IF NOT EXISTS reversal_of_transfer_id UUID REFERENCES transfers(id);

CREATE UNIQUE INDEX IF NOT EXISTS money_requests_one_reversal_per_transfer
    ON money_requests (reversal_of_transfer_id)
    WHERE reversal_of_transfer_id IS NOT NULL;

-- Shared-expense accounting is an intention layer. It records who paid and who
-- benefited, then lets each payer settle through the normal Transfer engine
-- (ADR-0009). None of these tables writes digital Journal Entries directly.
CREATE TABLE IF NOT EXISTS expense_groups (
    id                  UUID PRIMARY KEY,
    name                VARCHAR(80)  NOT NULL,
    created_by_user_id  UUID         NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT expense_groups_name_nonblank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS expense_groups_creator_idx
    ON expense_groups (created_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS expense_group_members (
    group_id    UUID        NOT NULL REFERENCES expense_groups(id),
    user_id     UUID        NOT NULL REFERENCES users(id),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS expense_group_members_user_idx
    ON expense_group_members (user_id, group_id);

CREATE TABLE IF NOT EXISTS group_expenses (
    id                  UUID PRIMARY KEY,
    group_id            UUID         NOT NULL REFERENCES expense_groups(id),
    paid_by_user_id     UUID         NOT NULL REFERENCES users(id),
    created_by_user_id  UUID         NOT NULL REFERENCES users(id),
    description         VARCHAR(140) NOT NULL,
    total_poisha        BIGINT       NOT NULL,
    split_type          VARCHAR(16)  NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT group_expenses_description_nonblank CHECK (length(btrim(description)) > 0),
    CONSTRAINT group_expenses_total_positive CHECK (total_poisha > 0),
    CONSTRAINT group_expenses_split_type_valid
        CHECK (split_type IN ('EQUAL', 'EXACT', 'PERCENTAGE'))
);

CREATE INDEX IF NOT EXISTS group_expenses_group_history_idx
    ON group_expenses (group_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS group_expenses_payer_idx
    ON group_expenses (paid_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS group_expenses_creator_idx
    ON group_expenses (created_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS group_expense_shares (
    expense_id     UUID   NOT NULL REFERENCES group_expenses(id),
    user_id        UUID   NOT NULL REFERENCES users(id),
    amount_poisha  BIGINT NOT NULL,
    PRIMARY KEY (expense_id, user_id),

    CONSTRAINT group_expense_shares_amount_positive CHECK (amount_poisha > 0)
);

CREATE INDEX IF NOT EXISTS group_expense_shares_user_idx
    ON group_expense_shares (user_id, expense_id);

CREATE TABLE IF NOT EXISTS group_settlements (
    id                 UUID        PRIMARY KEY,
    group_id           UUID        NOT NULL REFERENCES expense_groups(id),
    payer_user_id      UUID        NOT NULL REFERENCES users(id),
    recipient_user_id  UUID        NOT NULL REFERENCES users(id),
    amount_poisha      BIGINT      NOT NULL,
    transfer_id        UUID        NOT NULL REFERENCES transfers(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT group_settlements_distinct_users CHECK (payer_user_id <> recipient_user_id),
    CONSTRAINT group_settlements_amount_positive CHECK (amount_poisha > 0),
    CONSTRAINT group_settlements_transfer_recipient_unique
        UNIQUE (transfer_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS group_settlements_group_history_idx
    ON group_settlements (group_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS group_settlements_payer_idx
    ON group_settlements (payer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS group_settlements_recipient_idx
    ON group_settlements (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS group_settlements_transfer_idx
    ON group_settlements (transfer_id);

CREATE OR REPLACE FUNCTION group_accounting_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS group_expenses_append_only_trg ON group_expenses;
CREATE TRIGGER group_expenses_append_only_trg
    BEFORE UPDATE OR DELETE ON group_expenses
    FOR EACH ROW EXECUTE FUNCTION group_accounting_append_only();

DROP TRIGGER IF EXISTS group_expense_shares_append_only_trg ON group_expense_shares;
CREATE TRIGGER group_expense_shares_append_only_trg
    BEFORE UPDATE OR DELETE ON group_expense_shares
    FOR EACH ROW EXECUTE FUNCTION group_accounting_append_only();

DROP TRIGGER IF EXISTS group_settlements_append_only_trg ON group_settlements;
CREATE TRIGGER group_settlements_append_only_trg
    BEFORE UPDATE OR DELETE ON group_settlements
    FOR EACH ROW EXECUTE FUNCTION group_accounting_append_only();

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

CREATE TABLE IF NOT EXISTS notifications (
    id             UUID        PRIMARY KEY,
    user_id        UUID        NOT NULL REFERENCES users(id),
    kind           VARCHAR(32) NOT NULL,
    title          VARCHAR(120) NOT NULL,
    message        VARCHAR(240) NOT NULL,
    resource_type  VARCHAR(32),
    resource_id    UUID,
    read_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT notifications_kind_valid CHECK (
        kind IN ('MONEY_RECEIVED', 'REQUEST_RECEIVED', 'REQUEST_RESOLVED',
                 'REVERSAL_REQUESTED', 'SCHEDULE_EXECUTED', 'SCHEDULE_FAILED')
    )
);

CREATE INDEX IF NOT EXISTS notifications_user_history_idx
    ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

-- The lockout check runs on every login and filters on a JSON key, which
-- audit_type_idx cannot serve. audit_events is the highest-volume table in the
-- system, so without this the sign-in path degrades as the demo runs.
CREATE INDEX IF NOT EXISTS audit_auth_subject_idx
    ON audit_events ((metadata_json->>'subject'), created_at DESC)
    WHERE event_type IN ('LOGIN_FAILURE', 'LOGIN_SUCCESS');

-- Fixed-window counters live in PostgreSQL so every replica observes the same
-- allowance. Subjects are SHA-256 digests; raw client addresses are not retained.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
    scope              VARCHAR(32) NOT NULL,
    subject_hash       CHAR(64)    NOT NULL,
    window_started_at  TIMESTAMPTZ NOT NULL,
    request_count      INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (scope, subject_hash, window_started_at),
    CONSTRAINT rate_limit_count_positive CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS rate_limit_window_idx
    ON rate_limit_counters (window_started_at);

-- Each process refreshes one row every five seconds. Stale rows are retained as
-- useful operational history but are never counted as healthy.
CREATE TABLE IF NOT EXISTS replica_heartbeats (
    instance_id  TEXT        PRIMARY KEY,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS replica_heartbeat_freshness_idx
    ON replica_heartbeats (last_seen_at DESC);
