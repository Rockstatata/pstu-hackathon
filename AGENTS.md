# Repository Guidelines

## Project Structure & Module Organization

`backend/app/` contains the FastAPI service. Routers define the HTTP boundary, `services/transfer.py` is the sole money-moving path, and `services/ledger.py` owns Journal Entry writes. `backend/app/schema.sql` is the authoritative PostgreSQL schema; keep it re-runnable. Python regression tests live in `backend/tests/`. Reliability scenarios are under `tests/k6/`, with shared API assumptions isolated in `tests/k6/lib/config.js`.

Deployment files live in `infra/`, `docker-compose.yml`, and `docker-compose.prod.yml`. Product requirements, API contracts, ADRs, and agent references live in `docs/`. Read `CONTEXT.md` and relevant `docs/adr/` files before changing domain behavior or architecture. Track implementation progress in `tasks/todo.md`.

## Build, Test, and Development Commands

- `docker compose up -d` — start PostgreSQL, three API replicas, and nginx on port 8080.
- `docker compose logs -f api` — follow all API replica logs.
- `docker compose exec -T api python -m unittest discover -s tests -v` — run backend regressions against real PostgreSQL.
- `docker compose --profile chaos run --rm k6 run /scripts/01-duplicate-storm.js` — run one reliability scenario; replace the filename for scenarios 02–05.
- `docker compose --profile web up -d` — include the frontend once `web/` exists.

Production Compose requires values documented in `infra/azure/DEPLOY.md`; never reuse development secrets.

## Coding Style & Naming Conventions

Use Python with four-space indentation, type hints, `snake_case` functions/modules, and `PascalCase` classes. JavaScript uses two spaces and `camelCase`. Keep API responses camelCase and database columns snake_case. Use the exact domain terms in `CONTEXT.md`, especially Account, Transfer, Journal Entry, Money Request, and poisha. Store authoritative amounts as integer poisha—never floating-point taka.

## Testing Guidelines

Name Python tests `test_*.py` and methods `test_<behavior>`. Money-path changes require a regression test at the real seam plus a final `/api/v1/integrity` check. Use real PostgreSQL for locking, idempotency, rollback, daily-policy, and concurrency behavior; mocks cannot prove these properties. Every k6 scenario must exit nonzero when its claimed invariant fails.

## Commit & Pull Request Guidelines

Use focused Conventional Commits such as `fix: reject invalid group amounts`. Pull requests must explain affected financial invariants, link the issue/spec or ADR, list commands run, and include screenshots for UI changes. Explicitly call out schema, locking, idempotency, authentication, or deployment implications.

## Security & Financial Integrity

PostgreSQL is the financial authority. Route every movement through the atomic, idempotent Transfer engine. Preserve append-only Journal Entries, deterministic Account lock ordering, backend-derived sender identity, masked recipient data, and fail-closed behavior when authoritative storage is unavailable.
