# Testing and Reliability

## Test Layers

| Layer | Command | Proves |
|---|---|---|
| Compile/unit/service | `docker compose exec -T api python -m unittest discover -s tests -v` | Validation, policy, request lifecycle, OpenAPI drift |
| Black-box | `docker compose -f docker-compose.test.yml --profile verify run --rm acceptance` | Public HTTP behavior through nginx and three replicas |
| Concurrency/load | `docker compose -f docker-compose.test.yml --profile chaos run --rm k6 run /scripts/01-duplicate-storm.js` | Database locking/idempotency under real contention |
| Financial proof | `GET /api/v1/integrity` | Live Ledger and cached-balance invariants |

Mocks cannot prove PostgreSQL row locks, unique-constraint arbitration, commit rollback, or
cross-replica limits. These gates use PostgreSQL 16.

## Clean Test Stack

`docker-compose.test.yml` uses a PostgreSQL `tmpfs`, three production-style API containers, and
port `18080`. Each new stack begins without demo data.

```bash
docker compose -f docker-compose.test.yml up -d --build --wait
docker compose -f docker-compose.test.yml exec -T api \
  python -m unittest discover -s tests -v
docker compose -f docker-compose.test.yml --profile verify run --rm acceptance
```

OpenAPI must be deterministic:

```bash
docker compose exec -T api python scripts/openapi.py check /docs/openapi.json
# After an intentional contract change:
docker compose exec -T api python scripts/openapi.py export /docs/openapi.json
```

## Failure Laboratory

Scenarios 01–06 prove duplicate collapse, double-spend prevention, deadlock-free ordered locks,
sustained three-replica service, replica crash safety, and exactly-one Money Request payment.
Run scenario 05 last and kill one named API container, never the whole service.

The chaos-only endpoint fails after Journal Entries are inserted but before cached balances update.
A passing test observes `503 CHAOS_INJECTED`, unchanged balances, no surviving Transfer, and
`HEALTHY` integrity.

## Latest Verified Evidence

On 29 August 2026, the clean stack passed 33 backend tests and the expanded black-box gate. k6
results after Smart Wallet, settlement, Reversal, notifications, and scheduling were integrated:

- duplicate storm: 1 commit, 49 replays;
- double-spend: 10 commits, 10 correct insufficient-funds rejections;
- deadlock pressure: 661 commits, zero 5xx and zero deadlock/lock failures;
- sustained load: 4,503 commits, three replicas observed, p95 826 ms;
- replica kill: 1,246 commits and 31 expected failures, pool total unchanged;
- request payment storm: 1 payment, 49 terminal conflicts.

Final database checks were zero deadlocks, zero negative User Accounts, zero unbalanced Transfers,
3/3 fresh replicas, and integrity `HEALTHY` with zero difference.

The pressure run exposed one gateway timeout while the API safely committed at 5.16 seconds. nginx
now waits 15 seconds for a response, above the database's per-lock timeout. A minimized 48-VU,
10-second regression completed 173 Transfers with zero 5xx; the original 45-second scenario then
passed unchanged. The gateway still never retries a money write onto another replica.

## Troubleshooting

- `403 STEP_UP_REQUIRED`: retry the same intention/key with the PIN.
- `409 REQUEST_IN_PROGRESS`: wait briefly and retry the same key.
- `409 MONEY_REQUEST_NOT_PENDING`: another action won; refresh request detail.
- `429 RATE_LIMITED`: obey `Retry-After`.
- `503 FINANCIAL_CORE_UNAVAILABLE`: outcome may be uncertain; inspect history and reuse the key.
- nginx HTML error: configuration is stale; recreate/restart the gateway so its JSON 503 mapping loads.
