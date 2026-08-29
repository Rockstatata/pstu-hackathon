# Repository Guidelines

## Project Structure & Module Organization

This repository is documentation-first. Read `CONTEXT.md` for canonical vocabulary and `CLAUDE.md` for engineering constraints. Product and architecture sources live in `docs/`: the official brief is `docs/problem statement.pdf`, research is in `docs/mfs-deep-research.md`, and requirements are in `docs/solution-prd`. Agent workflow references live under `docs/agents/`; planning notes belong in `tasks/`.

The PRD targets a monorepo with `apps/web/` (Next.js), `apps/api/` (NestJS), `packages/shared/`, `infra/`, and `tests/k6/`. Add code to those locations when scaffolding begins; avoid creating competing top-level layouts.

## Build, Test, and Development Commands

No package manifest, Docker Compose file, or test configuration exists yet. Do not claim builds pass until those files are added. When scaffolding, expose workflows through root-level scripts and document them in `README.md`. Intended commands are:

- `docker compose up` — start the local web, gateway, API, and PostgreSQL stack.
- `docker compose --profile chaos up` — include k6/Toxiproxy reliability tooling.
- `npm test` and `npm run lint` — run automated checks once configured.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation and repository-configured ESLint/Prettier rules. Name React components and exported types in `PascalCase`, functions and variables in `camelCase`, and files in `kebab-case`. Use domain terms exactly as defined in `CONTEXT.md`: prefer `Account`, `Transfer`, `Journal Entry`, and `Money Request` over avoided synonyms. Store money as integer poisha; never use floating-point taka for authoritative calculations.

## Testing Guidelines

Place unit tests beside their modules as `*.spec.ts`; keep database integration tests clearly separated and run them against real PostgreSQL. Concurrency, idempotency, rollback, and reconciliation tests are mandatory for money-moving changes—mocks cannot prove locking behavior. Put load scenarios in `tests/k6/`. Every financial test should verify balanced journal entries, unchanged state after failure, and no negative balances.

## Commit & Pull Request Guidelines

History is minimal, but the substantive commit uses Conventional Commits (`feat: ...`). Continue with concise forms such as `fix: prevent duplicate transfer`. Keep commits focused. Pull requests should explain the behavior and financial invariants affected, link the relevant issue/spec, list commands run, and include screenshots for UI changes. Call out schema, locking, idempotency, or security implications explicitly.

## Security & Financial Integrity

The backend and PostgreSQL are the sole financial authority. Never trust client balances or sender IDs, cache authoritative balances, edit completed journal entries, or log credentials and tokens. Route every money movement through one atomic, idempotent transfer path.
