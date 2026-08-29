# Codebase Tour

This guide starts with the product idea and ends at the files that implement it. Read
`CONTEXT.md` first when a domain word is unfamiliar.

## The Product in Plain Language

Every registered User owns one BDT Account and receives a simulated ৳100,000 grant. A User can
send to one or many people, inspect history, and request payment. PostgreSQL is the authority:
the browser never decides who is sending or what their balance is.

A completed Transfer is permanent. Its Journal Entries are signed integers: the sender has one
negative entry and recipients have positive entries whose sum exactly cancels it. A Money Request
is different: it is only an intention until its payer accepts it.

Physical cash belongs to a separate Smart Wallet inventory journal. Shared Expenses produce
non-financial settlement plans whose approved payments still use the Transfer engine. A Scheduled
Transfer is likewise an intention until the worker claims it and completes a normal Transfer.

## Repository Map

| Path | What belongs there |
|---|---|
| `backend/app/routers/` | HTTP inputs, auth dependencies, headers, and response shapes |
| `backend/app/services/transfer.py` | The one orchestration path for User money movement |
| `backend/app/services/ledger.py` | Account locks, Transfers, Journal Entries, cached balances |
| `backend/app/services/money_requests.py` | Request lifecycle; delegates payment to Transfer |
| `backend/app/services/smart_wallet.py` | Physical cash observations and explicit reconciliation |
| `backend/app/services/group_settlement.py` | Shared Expense positions and consent-preserving plans |
| `backend/app/services/scheduled_transfers.py` | Future intentions and one-row worker claims |
| `backend/app/workers/scheduler.py` | Private worker loop for due Scheduled Transfers |
| `backend/app/schema.sql` | Authoritative, re-runnable PostgreSQL schema |
| `backend/tests/` | Service/regression tests against real PostgreSQL |
| `tests/blackbox/` | Public-contract acceptance test through nginx and three replicas |
| `tests/k6/` | Concurrency, load, crash, and payment-storm proofs |
| `docs/openapi.json` | Deterministic frontend contract snapshot |
| `web/` | Responsive Next.js PWA; `lib/api.ts` is its only wire-contract seam |
| `infra/` | nginx, Caddy, and Azure deployment configuration |

## How a Transfer Moves

1. `routers/transfers.py` validates the form and requires an `Idempotency-Key`.
2. `deps.py` resolves the User and Account from the JWT.
3. `services/transfer.py` reserves the key, resolves recipients, and asks `ledger.py` to lock every
   Account in UUID order.
4. Policy and Step-Up run while the sender lock protects the balance and daily total.
5. `ledger.post()` inserts the Transfer and balanced Journal Entries, then updates cached balances.
6. The exact receipt is stored with the idempotency record. The router commits once.

Any exception rolls back all six effects. A replay returns the stored receipt without moving money.

## Where to Start a Change

- New endpoint shape: router and `docs/api-contract.md`.
- New money-moving intention: orchestrate `services/transfer.execute()`; never write balances.
- New invariant: database constraint plus a real-PostgreSQL regression.
- Frontend integration: `docs/frontend-integration.md` and `docs/openapi.json`.
- Reliability change: `docs/testing-and-reliability.md` and the closest k6 scenario.
