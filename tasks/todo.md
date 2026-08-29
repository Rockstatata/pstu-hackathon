# Build Plan — Money Movement Application

## Backend–Frontend merge readiness (current)

- [x] Freeze and verify the existing backend foundation on `main`.
- [x] Add the complete Money Request lifecycle and concurrent-payment proof.
- [x] Add database-backed rate limits, body/query bounds, safe failure semantics,
      structured logs, and replica heartbeats.
- [x] Export deterministic OpenAPI and make drift a test failure.
- [x] Run unit, black-box, three-replica, k6, and final Ledger-integrity gates.
- [x] Publish the codebase tour, architecture, frontend integration, and reliability guides.
- [ ] Merge the frontend branch only after the backend contract is green.

Release boundary: notifications, consent Reversals, and scheduled Transfers remain
deferred. Their frontend controls must stay hidden. Transaction detail must explain
that Reversals are unavailable in this release.

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

- [ ] `Request Reversal` raises a money request linked to the original transfer
- [ ] Block reversal-of-reversal and group legs, with a stated reason (ADR-0005)
- [ ] Wire into Screen E2

## Phase 10 — Risk-based step-up (30m)

- [x] Deterministic rule table in the policy module: ≥ ৳25,000, first-time recipient, ≥5 in 10 min
- [x] Persist the risk decision + reason on the transfer
- [ ] Screen C3; surface the reason on E2

## Phase 11 — Notifications (20m)

- [ ] `notifications` written **in the same transaction** as the journal entries
- [ ] Poll every 10s; no WebSockets, no Web Push
- [ ] Screen H1

## Phase 12 — Scheduled transfers (50m) — *added at user request over a Tier-2 recommendation*

- [ ] `scheduled_transfers` table with its own lifecycle (a pending *intention*, never a pending Transfer)
- [ ] Worker container executing due transfers through the same idempotent engine
- [ ] Failure recorded with a reason; no silent retry storms
- [ ] Screens G1, G2

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

