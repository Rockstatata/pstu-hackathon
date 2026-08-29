# Build Plan — Money Movement Application

## Backend–Frontend merge readiness (current)

- [x] Freeze and verify the existing backend foundation on `main`.
- [x] Add the complete Money Request lifecycle and concurrent-payment proof.
- [x] Add database-backed rate limits, body/query bounds, safe failure semantics,
      structured logs, and replica heartbeats.
- [x] Export deterministic OpenAPI and make drift a test failure.
- [x] Run unit, black-box, three-replica, k6, and final Ledger-integrity gates.
- [x] Publish the codebase tour, architecture, frontend integration, and reliability guides.
- [x] Merge the frontend branch only after the backend contract is green.

Release boundary update: notifications, consent Reversals, Scheduled Transfers, Smart Wallet, and
Smart Group Settlement are now shipped against real endpoints. The remaining Phase 0.5 items are
external deployment verification, not hidden product controls.

**Deadline 15:00.** Plan written 10:35. Design locked via `/grill-with-docs`; see `CONTEXT.md` and `docs/adr/`.

Ordering rule: everything above the **CUT LINE** is the defensible product. Everything below is
upside. If the clock runs out, we stop at the line and demo what's above it — we do not ship a
half-built feature.

---

## Definition of done — applies to every UI task below

No screen is complete until it passes all four:
1. Works at **390px** first, then 768 and 1440 (mobile-first, `md:`/`lg:` additive)
2. Every interactive element is **≥44×44px**
3. Visible focus ring, labelled inputs, AA contrast
4. No emojis — `lucide-react` only

Responsiveness is a marked criterion, so it is never a later pass. See `docs/frontend-screens.md`.

---

## Phase 0 — Scaffolding (45m, by 11:20)

- [x] `docker-compose.yml`: postgres, api (3 replicas), gateway (nginx), web, k6
- [x] `backend/` FastAPI app skeleton, settings, health endpoint — **activate existing `backend/venv`, never recreate**
- [x] PostgreSQL schema: `users`, `accounts`, `journal_entries`, `transfers`, `idempotency_records`
- [x] Re-runnable `schema.sql` under an advisory lock (chosen instead of Alembic for the hackathon)
- [x] Seed the system **issuance account**
- [ ] `web/` Next.js PWA skeleton, Tailwind, lucide-react, mobile-first shell (bottom tabs → sidebar at `lg`)
- [x] CORS allowlist + `NEXT_PUBLIC_API_URL`; JWT sent as `Authorization: Bearer`, **not** a cookie

## Phase 0.5 — Prove the deploy path (30m, by 11:50) — *do this with a skeleton, not at 14:00*

- [x] Azure VM (B-series, student plan), Docker + Compose installed
- [x] Enable the `*.cloudapp.azure.com` DNS name on the VM's public IP
- [ ] Caddy in front of the gateway for automatic TLS — **required**: a Vercel HTTPS frontend cannot call an HTTP API
- [ ] `docker compose up -d` the skeleton; confirm `/health` over HTTPS
- [ ] Vercel project for `web/`, `NEXT_PUBLIC_API_URL` pointed at the Azure hostname
- [ ] Confirm one end-to-end call from the Vercel URL — CORS and TLS both proven
- [ ] Open the URL on a real phone; this is the responsive test device for the rest of the day

Redeploy from here on is `git pull && docker compose up -d --build` (~2m) plus Vercel auto-deploy on push.

## Phase 1 — Identity & issuance (30m, by 11:50)

- [x] Register: phone + name + bcrypt-hashed PIN
- [x] Issue ৳100,000 as a two-legged journal entry from the issuance account
- [x] Login, JWT, auth dependency
- [ ] Screens A1, A2

## Phase 2 — Transfer engine (60m, by 12:50) — *the core; do not rush this*

- [x] Money as integer **poisha** end to end
- [x] `POST /transfers` with `Idempotency-Key` header
- [x] Idempotency record inserted **in the same transaction**; unique violation is the concurrency guard
- [x] Replay returns the stored original response; different body with same key returns 409
- [x] Collect all touched accounts, **sort by account ID ascending**, `SELECT ... FOR UPDATE` in order
- [x] Set `lock_timeout`; no deadlock-retry loop (ADR-0003)
- [x] Write journal legs summing to zero + update cached balances in one transaction
- [x] Balance check inside the lock; reject overspend
- [x] Transfer Policy module: amount > 0, ≤ ৳100,000/txn, ≤ ৳200,000/day
- [x] Recipient lookup endpoint (name + masked phone)

## Phase 3 — Send flow UI (40m, by 13:30)

- [ ] Screens C1, C2 (Recipient Verification), C4 (Receipt)
- [ ] `AmountDisplay` / `AmountInput` — the single formatter
- [ ] Screen B1 (Home) with balance card + recent transactions

## Phase 4 — History (20m, by 13:50)

- [x] `GET /transfers`, `GET /transfers/{reference}`
- [ ] Screens E1, E2

## Phase 5 — Integrity dashboard (30m, by 14:20) — *judge-facing, highest value per minute*

- [x] `GET /integrity` computing all five assertions live, no caching:
  - [x] global journal sum = 0
  - [x] per-account journal sum = cached balance
  - [x] zero negative balances
  - [x] every transfer has ≥2 legs summing to zero
  - [x] issuance account = −(sum of user balances)
- [x] Counters: completed transfers, idempotent replays, rejected overspends, step-ups
- [x] Replica health across the 3 API instances
- [ ] Screen I1

## Phase 6 — Concurrency proof (30m, by 14:50)

- [x] k6: duplicate-key storm ×50 → exactly 1 transfer
- [x] k6: 20 concurrent sends of ৳100 from ৳1,000 → exactly 10 succeed
- [x] k6: A↔B bidirectional + group pressure → zero deadlocks
- [x] k6: sustained load across replicas → p95 828ms, integrity green after
- [x] `docker kill` a replica mid-load → no money lost

## ===== CUT LINE — everything above is the demo =====

## Phase 7 — Money Requests (40m)

- [x] `money_requests` table; status **derived**, expiry evaluated lazily at read *and* inside the payment transaction
- [x] Create / pay / decline / cancel; paying routes through the normal transfer engine
- [ ] Screens F1, F2, F3

## Phase 8 — Group Transfers (40m)

- [x] Atomic multi-leg transfer, all-or-nothing (ADR-0002)
- [x] Same sorted lock acquisition over N+1 accounts
- [ ] Screen D1; confirmation lists every recipient

## Phase 9 — Reversal (15m, requires Phase 7)

- [x] `Request Reversal` raises a money request linked to the original transfer
- [x] Block reversal-of-reversal and group legs, with a stated reason (ADR-0005)
- [x] Wire into Screen E2

## Phase 10 — Risk-based step-up (30m)

- [x] Deterministic rule table in the policy module: ≥ ৳25,000, first-time recipient, ≥5 in 10 min
- [x] Persist the risk decision + reason on the transfer
- [ ] Screen C3; surface the reason on E2

## Phase 11 — Notifications (20m)

- [x] `notifications` written **in the same transaction** as the journal entries
- [x] Poll every 10s; no WebSockets, no Web Push
- [x] Screen H1

## Phase 12 — Scheduled transfers (50m) — *added at user request over a Tier-2 recommendation*

- [x] `scheduled_transfers` table with its own lifecycle (a pending *intention*, never a pending Transfer)
- [x] Worker container executing due transfers through the same idempotent engine
- [x] Failure recorded with a reason; no silent retry storms
- [x] Screens G1, G2

## Phase 13 — Polish (whatever remains)

- [ ] Offline banner + disabled send (ADR-0004)
- [ ] Empty states, skeletons, plain-language errors
- [ ] Demo script rehearsal

---

## Frontend implementation — `web/`

Runs against `docs/design-system.md` (tokens, colour law) and `docs/frontend-screens.md` (screens,
states, responsive). Built to the API contract in `docs/solution-prd` §26–27 so it drops onto the
real backend without a rewrite. **No authoritative money logic in the client** — the UI formats,
validates for UX, and submits intentions; every balance and status shown comes from a response body.

> **Status at handoff — see `web/HANDOFF.md`.** FE-0 is done and FE-1/2/4 are partly done.
> `npm run build` has never been run, so none of it is compile-verified. Two known breaks are
> listed in the handoff. No screens exist yet — FE-5 onward is untouched.

### FE-0 — Scaffold and tokens

- [x] `create-next-app` into `web/`: TypeScript, App Router, `src/`, Tailwind, ESLint
- [x] `globals.css`: both token blocks from `docs/design-system.md`, `:root` + `.dark`
- [x] Inter via `next/font/google`; `tabular-nums` utility for money
- [x] No-flash theme script in `layout.tsx`, `localStorage.theme` then `prefers-color-scheme`
- [x] `lucide-react`

### FE-1 — Primitives

- [ ] `Button` (primary / secondary / ghost / danger), 44px min, focus ring
- [ ] `Input`, `Label`, field error wired via `aria-describedby`
- [ ] `Card`, `Modal` / `BottomSheet` (sheet below `md`, centred modal at `md`+)
- [ ] `Tabs`, `Avatar`, `StatusBadge` (8 states × 2 themes), `EmptyState`, `Skeleton`, `Toast`

### FE-2 — Money and identity

- [ ] `formatTaka` — poisha integer in, `৳2,500.00` out. The only formatter in the codebase.
- [ ] `AmountDisplay` — direction law: in `+`/green, out `−`/neutral, reversal, failed
- [ ] `AmountInput` — poisha-backed, `inputMode="numeric"`, balance and policy messages
- [ ] `PhoneInput`, `MaskedPhone`, `PinInput`, `RecipientCard`, `RecipientChip`
- [ ] `BalanceCard` — the one gradient surface, Eye/EyeOff, offline state

### FE-3 — Shell

- [ ] Bottom tab bar below `lg` (Home · History · Requests · More), sidebar at `lg`+
- [ ] Header with `NotificationBell`, theme toggle
- [ ] `OfflineBanner` — `navigator.onLine`, disables send actions (ADR-0004)

### FE-4 — API client

- [ ] Typed client for `/auth`, `/accounts/me`, `/users/search`, `/transfers`, `/internal/integrity`
- [ ] `Idempotency-Key` generated once per compose session, resent unchanged on retry
- [ ] JWT in `Authorization: Bearer` — not a cookie (ADR-0007)
- [ ] Error contract `{error:{code,message,traceId}}` → plain sentences, never a raw code

### FE-5 — P0 screens

- [ ] A1 Register, A2 Login, A3 Funded welcome
- [ ] B1 Dashboard
- [ ] C1 Compose → C2 Recipient Verification → C4 Receipt
- [ ] E1 History, E2 Transaction Detail

### FE-6 — I1 Integrity Dashboard

- [ ] Always dark, projector-sized: 56px tabular metrics, `VerdictBanner`, `ReplicaStatus`
- [ ] Live values only, no caching, no fabricated numbers

### FE-7 — Quality gate

- [ ] 390 / 768 / 1440 verified; 44px targets; visible focus; one `h1` per screen
- [ ] Loading, empty, error, offline for every screen that fetches
- [ ] No hard-coded hex outside `globals.css`; no emoji; no inline `toFixed`

---

## Review


Built the backend financial core through the P0/P1 merge boundary, including Money Requests,
Group Transfers, risk rules, shared rate limits, structured logs, failure semantics, and replica
heartbeats. The clean test stack has three stateless API replicas behind nginx, a double-entry
Ledger, concurrency-safe idempotency, 16 passing backend tests, a passing black-box gate, and six
passing k6 reliability scenarios.

The implementation uses re-runnable raw SQL instead of Alembic/ORM models and phone + PIN instead
of email + password. The frontend branch is not available locally yet. Consent-based Reversals,
notifications, and scheduled Transfers remain deferred and their controls must be hidden. Azure
infrastructure is provisioned, but application deployment and TLS verification remain pending.

_To be filled in when the build is complete: what was built, what was cut, what changed from this plan._

---

## Frontend extension — P1 and P2 flows

- [x] Verify the current frontend baseline and repair any pre-existing type error that blocks it.
- [x] Complete P1 money-request actions/detail and notification listing, using `api` only.
- [x] Complete P2 scheduled-transfer list/creation and minimal profile/settings routes, using typed service methods only.
- [x] Expose only complete routes through navigation and quick actions; retain offline safeguards and recipient verification.
- [x] Run lint and production build; record the result below.

### Review — frontend extension

Implemented P1 request detail/actions and notifications, plus P2 scheduled transfers and settings.
All components call the typed `api` service surface; no components contain endpoint paths or client-side
financial authority. Request payment retains recipient verification and uses the normal receipt route.

Verification: `cmd /c "npm run lint && npm run build"` in `web/` passes with no lint warnings.

---

## Frontend separation — User and Admin/Judge experiences

- [x] Remove the integrity route from the consumer shell and focus navigation on money movement and the smart-card account view.
- [x] Build a separate `/admin` operations shell and dashboard, using a frontend-only typed demo data boundary.
- [x] Make transaction, idempotency, concurrency, ledger, health, audit, and exception states legible in a judge demonstration.
- [x] Verify responsive frontend compilation with lint and a production build.

### Review — frontend separation

Consumer navigation is limited to Home, History, Requests, and the Smart Account Card. The previous
consumer integrity route was removed. `/admin` uses a distinct always-dark operations shell and
labels its data as a frontend-only demonstration. `lib/admin-demo.ts` is the only data seam the
Admin/Judge dashboard consumes, so it can later be replaced without a UI rewrite.

Verification: `cmd /c "npm run lint && npm run build"` in `web/` passes; the production build emits
18 routes, including `/admin` and `/wallet`, with no `/integrity` route.


---

## Backend–frontend integration repair (post-merge)

The merge of `97425bd` into `main` is textually clean, but the two halves were built against
different contracts. `web/src/lib/api.ts` targets the speculative contract in `docs/solution-prd`
§26–27; the shipped backend is `docs/openapi.json`. Almost every path, field name, and required
header differs, so the frontend currently cannot complete a single call against the running stack.

Approach: put the wire↔view translation in **one seam** (`lib/api.ts` + `lib/types.ts`). Component
view models keep their present shape, so the ~35 UI files stay untouched. Financial truth still
comes only from a response body.

- [x] 1. Retarget `lib/types.ts` to the shipped contract and split wire types from view models.
- [x] 2. Rewrite `lib/api.ts` against `docs/openapi.json`: real paths, real bodies, camelCase
      poisha fields, `Idempotency-Key` on every money-moving POST, and mapping into view models.
- [x] 3. Replace `RecipientPreview.userId` (the backend never returns a user id) with `phone`
      everywhere it is used as a key: send, group send, request create, request detail, sheet.
- [x] 4. Handle `403 STEP_UP_REQUIRED`: wire the orphaned `StepUpDialog` into the send flow and
      request payment, resubmitting the same body and the same key with `pin`.
- [x] 5. Wire `/admin` to the live `GET /integrity` and `GET /system-info`; delete `lib/admin-demo.ts`.
      A judge-facing dashboard must not render invented numbers.
- [x] 6. Delete `lib/fixtures.ts` and `FixtureNotice` — a client-side ledger contradicts the
      architectural rule and now mirrors a dead contract.
- [x] 7. Enforce the release boundary in the UI: remove the `/notifications` and `/scheduled`
      routes (no server endpoint exists) and keep them out of navigation.
- [x] 8. Replace the hard-coded recent-recipient list with `GET /users/recent-recipients`.
- [x] 9. Add `web/Dockerfile` and correct the compose env var to `NEXT_PUBLIC_API_URL`.
- [x] 10. `npm install`, `npm run lint`, `npm run build` — all green.
- [x] 11. End-to-end proof against the running three-replica stack: register → balance → lookup →
      transfer → receipt → history → step-up → money request → pay → integrity.
- [x] 12. Refresh `web/HANDOFF.md` (currently stale) and record the review below.

### Review — integration repair

The merge itself was clean; the integration was not. The frontend called eleven endpoints that do
not exist and sent field names the API rejects, so no screen could have completed a call. That is
now closed at one seam: `lib/types.ts` separates wire types from view models and `lib/api.ts` is the
only module that names a backend field. The ~35 component files were left alone apart from the five
places that keyed a recipient by a `userId` the backend never issues.

Three findings worth carrying forward:

1. **Step-up fires on the first send to any new recipient**, not only over ৳25,000. `StepUpDialog`
   existed but was wired to nothing, so the first demo send would have failed. It is now wired into
   `/send`, `/send/group`, and money-request payment, resubmitting the same body and the same
   Idempotency-Key with the PIN.
2. **`/admin` rendered invented numbers** from `lib/admin-demo.ts` on the judge-facing screen. It now
   reads `GET /integrity` and `GET /system-info` live every 5s, shows all five assertions, the
   issued-versus-held totals, the audit counters, per-replica heartbeats, and the enforced policy
   limits — and shows an explicit "no verdict available" state rather than a fallback figure.
3. **`lib/fixtures.ts` was a client-side ledger.** Deleted, with `FixtureNotice`, `admin-demo.ts`,
   `NotificationBell`, and the `/notifications` and `/scheduled` routes, whose endpoints do not
   exist in this release.

Also: real recent recipients replace a hard-coded list, money requests are queried by direction
instead of filtered client-side, `web/Dockerfile` now exists so the compose `web` profile runs, and
the compose env var was corrected to the `NEXT_PUBLIC_API_URL` the client actually reads.

Verification: `npx next build` and `npx eslint src` clean; 16 routes emitted. Fourteen live checks
against the running three-replica stack — registration and issuance, balance, lookup, step-up
demanded then satisfied on the same key, idempotent replay returning the original receipt, signed
ledger legs, `reversible: false`, the `recipients[]` group form, money-request create/list/pay, the
second payment rejected as `MONEY_REQUEST_NOT_PENDING`, recent recipients, integrity `HEALTHY` with
zero difference, and 3/3 replicas.

Not done: no browser click-through, so the wiring is proven at the contract level rather than by
driving the UI; and Phase 0.5 (Caddy TLS, Vercel, phone check) is still open.

---

## Smart extensions and release completion (Codex owner)

Coordination boundary: the concurrent frontend-integration session owns all currently modified
`web/` files listed by `git status`. This work starts in new backend modules, tests, domain docs,
and new frontend routes; shared frontend seams are integrated only after that session's build is
stable and its diff has been re-read.

- [x] 1. Reconcile the concurrent integration diff, run its lint/build/tests, and record remaining
      contract gaps without overwriting active work.
- [x] 2. Define Smart Wallet terms and record the architectural boundary between the conserved
      digital Ledger and the append-only Cash Inventory Journal.
- [x] 3. Implement the authenticated Smart Wallet API: expected cash, connection simulation,
      idempotent cash observations, immutable history, and explicit Cash Count Reconciliation.
- [x] 4. Add PostgreSQL-backed regression tests proving ownership isolation, idempotency,
      concurrent-event safety, append-only history, reconciliation, and unchanged Ledger integrity.
- [x] 5. Add the responsive Smart Wallet screen in the existing Chorui design system, with
      simulator controls, connection/last-sync state, activity, and reconciliation flow.
- [x] 6. Implement Smart Group Settlement as Group accounting plus an explainable settlement plan;
      preserve per-payer consent and route each approved outgoing movement through the Transfer engine.
- [x] 7. Finish the remaining authorized product work: Reversals, notifications, scheduled Transfer
      intentions, their screens, and release-boundary documentation.
- [x] 8. Run backend regressions, frontend lint/build, Compose integration, k6 invariants, and the
      final `/api/v1/integrity` gate; update contracts, handoff, and this review.

### Review — smart extensions and release completion

Implemented the Smart Wallet as a separate append-only Cash Inventory Journal, with connection
simulation, idempotent Cash Events, and explicit Cash Count Reconciliation. Implemented immutable
Expense Groups and explainable Net Positions; each member approves only their own outgoing Group
Settlement through the existing Transfer engine.

Finished the previously deferred consent Reversal, Notification, and Scheduled Transfer lifecycles.
Scheduled instructions require PIN authorization without storing the PIN, are claimed with
`FOR UPDATE SKIP LOCKED`, and commit their resulting Transfer/status/notifications atomically.

Verification: 33 backend tests and the expanded black-box gate pass on a clean PostgreSQL stack;
frontend lint and production build pass with 21 routes. Duplicate, overspend, deadlock-pressure,
sustained-load, replica-kill, and Money Request payment storms pass. The final Ledger is `HEALTHY`
with zero difference. A pressure-only nginx timeout was reproduced, minimized, fixed at the gateway
boundary, and rerun at both 48-VU/10-second and default 24-VU/45-second settings.

External follow-up remains Phase 0.5 only: deploy the current commit to Azure/Vercel, verify public
TLS/CORS end to end, and perform the real-phone click-through. Those actions require deployment
credentials and a physical device and were not claimed as locally completed.

---

## Deterministic Financial Outlook

- [x] Define Financial Outlook, Goal Projection, and Typical Money Out without introducing a health score.
- [x] Add a read-only Account analytics module using Dhaka month boundaries and integer-poisha arithmetic.
- [x] Compare month-to-date against the same elapsed part of the previous month and expose every rule.
- [x] Return honest no-baseline states for new Accounts and exclude registration issuance.
- [x] Build the responsive `/outlook` screen with trends, buffer context, recipient concentration, and history.
- [x] Add a fixed-control Goal Projection with disclosed formulas and no financial write path.
- [x] Add the typed frontend seam, navigation, OpenAPI snapshot, regression tests, and Docker context hygiene.

### Review — deterministic Financial Outlook

Financial Outlook is a read-only interpretation of completed Journal Entries. It does not classify
Users, produce advice, call an AI provider, or create Transfers. Goal Projection runs through one pure
integer-poisha module and models only the Account Balance, target, monthly set-aside, and an optional
reduction applied to Typical Money Out. The screen names its assumptions and formula.

Verification: 35 backend tests pass against PostgreSQL; frontend lint and production build pass with
22 routes; the authenticated endpoint was exercised through the three-replica gateway; the final
Integrity Check remained `HEALTHY` with zero difference; and `/outlook` was visually checked at 390px.

---

# Post-deadline hardening — audit, admin console, and the proof harness

Plan written 15:02, 29 Aug 2026, after the 15:00 boundary. Scope requested: scan for scalability
and UX improvements, then make concurrency / database behaviour presentable to judges. Amended
mid-plan: the admin console must ship both themes with a toggle, and carry more insight.

Model note: Opus at standard effort is right for the audit and the metrics design; the k6 harness
scripting alone would be fine on Sonnet.

## Part 1 — Admin console theming (requested)

- [x] Remove the unconditional dark palette from `.admin-experience`; let the console inherit
      `:root` / `.dark` so both themes ship. Keep the class as the ops-specific hook.
- [x] Set `color-scheme` per theme rather than hard-coding `dark`.
- [x] Mount `ThemeToggle` in `AdminShell` (sidebar footer and mobile header).
- [x] Re-check contrast of the verdict banner and assertion rows in light mode.
- [x] Update `docs/design-system.md`: I1 is no longer dark-only.

## Part 2 — Admin console insight (requested)

Everything below is read live from PostgreSQL. No number is computed in the browser, no number is
cached, and anything scoped to one replica says so on the card.

- [x] `GET /api/v1/system-metrics` — new read-only endpoint:
      - database: xact_commit / xact_rollback / commit ratio, deadlocks, cache hit ratio,
        active connections vs max_connections, database size
      - throughput: transfers and Journal Entries in the last 60s and 15m, busiest minute in the
        last hour, per-minute series for a sparkline
      - concurrency: idempotent replays, rejected overspends, step-ups, policy rejections,
        lock timeouts — last hour and all time
      - latency: this replica's rolling p50 / p95 / p99 over its last 500 requests, labelled
        per-instance because it is process memory, not database truth
      - pool: SQLAlchemy checked-out / size / overflow for this replica
- [x] Rolling latency ring buffer in the request middleware (bounded, allocation-free per request)
- [x] Admin panel sections: Throughput (with per-minute sparkline), Database health, Concurrency
      defence, Latency. Token-driven SVG, no chart library, no emoji.
- [x] Wire types + mapper in `lib/api.ts` only, per the handoff rule.

## Part 3 — Scalability fixes found in the audit

- [x] **Connection pool vs thread pool.** Sync endpoints run on anyio's 40-thread default while the
      engine offers 10+20=30, and rate-limited paths open a second session while holding one —
      so ~15 concurrent rate-limited requests per replica exhausts the pool and 503s. Size both
      from settings and set an explicit `pool_timeout`.
- [x] **Retention.** `idempotency_records`, `rate_limit_counters` and `audit_events` grow without
      bound. Add a bounded purge sweep to the scheduler loop.
- [x] **`/integrity` cost.** 12 aggregate queries, ~110ms at 23k Journal Entries, growing linearly,
      polled every 5s per open dashboard. Keep it live — add `computedInMs` so the cost is visible
      and honest rather than hidden.

## Part 4 — The proof harness (judge-facing)

- [x] `handleSummary()` in each k6 scenario → machine-readable JSON per scenario
- [x] `tests/bench/collect.py` — snapshot `pg_stat_database` and the integrity report before and
      after each scenario, merge with the k6 summaries
- [x] `tests/bench/run-proof.ps1` — one command: all six scenarios in order, replica kill automated
- [x] `tests/bench/report.py` — render `docs/PROOF.md` and a self-contained offline `proof.html`
- [x] Record what the run does **not** prove, in the same document


---

## Review — what changed and why

### Admin console theming (the reported bug)

`.admin-experience` in `web/src/app/globals.css` re-declared the entire dark palette
unconditionally, so the console could never be light no matter what the toggle said — and the
toggle was never mounted in `AdminShell` in the first place. The block now declares only
`color-scheme` (light at base, dark under `.dark`) and every colour resolves from `:root` / `.dark`,
so there is still exactly one measured palette. `ThemeToggle` is mounted in the sidebar footer and
in the mobile header, mirroring `AppShell`. Verified in the compiled CSS: the rule emits
`color-scheme` and nothing else. `docs/design-system.md` and `CLAUDE.md` no longer claim I1 is
dark-only.

### Admin console insight

New `GET /api/v1/system-metrics`, read live like `/integrity` and unauthenticated for the same
reason. It carries database behaviour from `pg_stat_database` (commits, rollbacks, deadlocks,
cache hit rate, connections, queries blocked on locks), measured throughput per minute for the last
hour, the audit-derived record of what concurrency control refused, stored-row counts, and — scoped
to one replica and labelled as such — request latency percentiles and connection pool use.

Four new sections render it: Throughput with a token-drawn sixty-bar chart, Database behaviour,
Response time with pool utilisation, and a table of what concurrency control refused. `/integrity`
now also reports `computedInMs`, so the cost of recomputing the proof is visible rather than
hidden — the honest alternative to caching a verdict that would then prove nothing.

### Scalability fixes

- **Connection pool sized against the thread pool.** Sync endpoints ran on anyio's 40-thread
  default while the engine offered 30 connections, and rate-limited paths hold two at once. Pool is
  now 20+20 with the thread pool bounded to 20, so `threads * 2 <= capacity` and exhaustion is
  structurally impossible rather than merely unlikely.
- **Pool checkout timeout cut to 5s** from SQLAlchemy's 30s default, which outlived nginx's 15s
  read timeout — the caller would have been told the outcome was unknown for a request that had not
  started.
- **Retention sweeps** for `rate_limit_counters` and `idempotency_records`, bounded per pass and
  run from the scheduler. `audit_events` and `journal_entries` are deliberately never swept, and
  the module says why.
- **`transfers_created_at_idx`**, without which the console's per-minute query would seq-scan the
  whole table every five seconds during the load test it is measuring.

### The uncertain-outcome UX defect

`POST /transfers` answering `503 FINANCIAL_CORE_UNAVAILABLE` or `409 REQUEST_IN_PROGRESS` was
rendered as "Transfer failed. No transaction ID was issued." Both mean the outcome is *unknown*,
and the backend's own message says to check history before retrying. Claiming a definite failure
for money that may have moved is the exact property this build is judged on. `isUncertainOutcome()`
now classifies those codes plus `NETWORK` and `INTERNAL_ERROR`; the send flow keeps the compose
screen and the same Idempotency-Key, and shows an amber "we do not know whether this went through"
panel with a link to history — amber because it needs a decision, not red, because nothing failed.
The `NETWORK` sentence no longer claims "Nothing was sent."

### The proof harness

`tests/bench/` — `run-proof.ps1` runs all six k6 scenarios in order, snapshots PostgreSQL either
side of each, kills a replica on a timer during scenario 5 instead of relying on an operator, and
renders `docs/PROOF.md`. Each scenario writes a machine-readable summary via `handleSummary`.

Two framing decisions in the report, both about not overselling:

- k6 scores every non-2xx as a failed request. In this system a `400 INSUFFICIENT_FUNDS` is the row
  lock working. The row is labelled with its real metric name and carries the reason, rather than
  reporting a working safeguard as a 35% failure rate.
- Commit ratio is presented next to what the rollbacks were. A duplicate-storm scenario is supposed
  to roll back most of what it starts.

The harness never decides that a run passed — k6 does, from thresholds declared before the run.

### Verification

35/35 backend unit tests, black-box acceptance `PASS`, OpenAPI drift check green after regenerating
the contract, `tsc` clean, `eslint` clean, `next build` compiles. k6 scenarios 01, 02 and 03 ran
green against the new pool settings.

### Known limits, unchanged

Single PostgreSQL writer, no failover, no network-partition testing. The load scenarios run at tens
of virtual users and demonstrate correctness under concurrency, not scale. `docs/PROOF.md` states
this in its own words at the end of every run.

---

# Documentation refresh — README and the two evidence documents

Plan written 29 Aug 2026, after the post-deadline hardening work landed. The three top-level
documents were last written before `system-metrics`, retention, the pool sizing, the admin console
theming, and the `tests/bench` proof harness existed, and before Scheduled Transfers, Notifications,
Smart Group Settlement, and Financial Outlook shipped. They currently understate the system and, in
three places, cite the wrong ADR.

Model note: Opus at standard effort for the evidence sections, which have to be written against the
actual diff rather than summarized; the README table edits alone would be fine on Sonnet.

## README.md

- [ ] Project status: add Financial Outlook, the operations console, retention sweeps, and the proof
      harness; correct the route count.
- [ ] Feature scope: add the behaviour shipped after the merge boundary.
- [ ] Component responsibilities: add the scheduler worker, `system_metrics.py`, `retention.py`,
      and `observability.py`.
- [ ] Technology choices: the idempotency trade-off no longer reads "no retention process"; add the
      pool-sizing and per-replica-latency rows; list ADRs 8–11.
- [ ] Endpoint summary: add the fourteen endpoints missing from the table, including
      `GET /system-metrics`.
- [ ] Reliability: document `tests/bench/run-proof.ps1` and `docs/PROOF.md` as the one-command pass.
- [ ] Configuration: add the four connection/thread pool variables.
- [ ] Observability: describe the operations console, `computedInMs`, and the per-replica boundary.
- [ ] Repository guide and documentation map: new modules, `tests/bench/`, `docs/PROOF.md`.
- [ ] Roadmap: retire the near-term items that shipped.

## ARCHITECTURE_DECISIONS_EVIDENCE.md

- [ ] Fix the three wrong ADR citations (idempotency and replica resilience are not ADR-0004; Money
      Requests are not ADR-0009).
- [ ] Add the decisions taken during hardening: pool sized against the thread pool, bounded retention
      with a stated exclusion list, `/integrity` cost published rather than cached away, latency as
      the one deliberate in-memory number, and the throughput index.
- [ ] Add ADR-0010 and ADR-0011 sections so every ADR in `docs/adr/` is traced.
- [ ] Add the proof harness to the testing strategy: k6 decides, the harness only reports.

## FEATURE_SHOWCASE_AND_EVIDENCE.md

- [ ] Add the four shipped features with no section: Scheduled Transfers, Notifications, Smart Group
      Settlement, Financial Outlook.
- [ ] Add the operations console as a feature, since it is the screen judges are actually shown.
- [ ] Correct the core-feature table, which credits the wrong test file in three rows.
