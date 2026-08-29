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

On 29 August 2026, the clean stack passed 16 backend tests and the black-box gate. k6 results:

- duplicate storm: 1 commit, 49 replays;
- double-spend: 10 commits, 10 correct insufficient-funds rejections;
- deadlock pressure: 736 commits, zero deadlock/lock failures;
- sustained load: 4,684 commits, three replicas observed, p95 765 ms;
- replica kill: 47 expected request failures, pool total unchanged;
- request payment storm: 1 payment, 49 terminal conflicts.

Final database checks were zero deadlocks, zero negative User Accounts, zero unbalanced Transfers,
3/3 fresh replicas, and integrity `HEALTHY` with zero difference.

## Troubleshooting

- `403 STEP_UP_REQUIRED`: retry the same intention/key with the PIN.
- `409 REQUEST_IN_PROGRESS`: wait briefly and retry the same key.
- `409 MONEY_REQUEST_NOT_PENDING`: another action won; refresh request detail.
- `429 RATE_LIMITED`: obey `Retry-After`.
- `503 FINANCIAL_CORE_UNAVAILABLE`: outcome may be uncertain; inspect history and reuse the key.
- nginx HTML error: configuration is stale; recreate/restart the gateway so its JSON 503 mapping loads.
