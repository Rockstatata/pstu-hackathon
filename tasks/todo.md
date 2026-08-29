# Build Plan — Money Movement Application

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

- [ ] `docker-compose.yml`: postgres, api (3 replicas), gateway (nginx), web, k6
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
- [ ] Replica health across the 3 API instances
- [ ] Screen I1

## Phase 6 — Concurrency proof (30m, by 14:50)

- [x] k6: duplicate-key storm ×50 → exactly 1 transfer
- [x] k6: 20 concurrent sends of ৳100 from ৳1,000 → exactly 10 succeed
- [x] k6: A↔B bidirectional + group pressure → zero deadlocks
- [x] k6: sustained load across replicas → p95 828ms, integrity green after
- [x] `docker kill` a replica mid-load → no money lost

## ===== CUT LINE — everything above is the demo =====

## Phase 7 — Money Requests (40m)

- [ ] `money_requests` table; status **derived**, expiry evaluated lazily at read *and* inside the payment transaction
- [ ] Create / pay / decline / cancel; paying routes through the normal transfer engine
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

## Review

Built the backend financial core through Phase 6 plus the Phase 8 Group Transfer engine and
Phase 10 risk rules. The local stack has three stateless API replicas behind nginx, a double-entry
Ledger, concurrency-safe idempotency, history, integrity reporting, login lockout, and five passing
k6 reliability scenarios.

The implementation uses re-runnable raw SQL instead of Alembic/ORM models and phone + PIN instead
of email + password. The frontend, Money Requests, Reversals, notifications, and scheduled
Transfers remain cut. Azure infrastructure is provisioned, but application deployment and TLS
verification are still pending.
