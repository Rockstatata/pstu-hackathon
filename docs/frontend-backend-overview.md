# Frontend and Backend Overview

This project is a money-movement application built around one principle: the backend is the only source of financial truth. The UI can show screens, collect a user’s intention, and present results, but it never decides whether money moved. That rule is the heart of both the frontend and backend design.

## 1. Big-picture idea

The app is a simulated Bangladeshi wallet system where users:

- register with a phone number and PIN
- receive a signup grant
- check balances
- send money to other users
- create and pay money requests
- inspect transfer history and integrity reports

The money system is intentionally small, but it is engineered to behave like a trustworthy financial app under stress, retries, and duplicate requests.

The most important rule is:

> The UI submits intentions; the backend determines the actual financial truth.

That means React state, browser local storage, or any client-side cache can never be treated as the real ledger.

---

## 2. Backend: what it is

The backend is a FastAPI service in `backend/app/`.

The main app entry is `backend/app/main.py`.

It does a few important things:

- starts the FastAPI app
- applies database schema on startup
- creates the system issuance account
- sets up CORS for the web app
- adds request logging and trace IDs
- handles validation and domain errors consistently
- runs a heartbeat loop to show replica health

This backend is designed to run as multiple replicas behind nginx. All replicas are stateless; the database is the real authority.

### Core backend architecture

The project is organized around a very clear separation:

- routers: HTTP boundary and request parsing
- services: actual financial logic
- database: authoritative state and ledger
- security/auth: JWT, PIN handling, lockout, and abuse controls

The main modules are:

- `backend/app/main.py` — app startup, middleware, logging, CORS, health behavior
- `backend/app/routers/auth.py` — registration/login/me endpoints
- `backend/app/routers/transfers.py` — transfer creation, idempotency, chaos testing routes
- `backend/app/services/transfer.py` — transfer execution logic
- `backend/app/services/ledger.py` — journal entry writing and money movement bookkeeping
- `backend/app/policy.py` — financial policy checks
- `backend/app/idempotency.py` — duplicate prevention and replay handling
- `backend/app/security.py` — hashing, JWT issuance, PIN verification
- `backend/app/db.py` — database session setup
- `backend/app/deps.py` — authenticated user dependency

### Why this backend is special

The project is not trying to be a normal CRUD app. It is trying to behave like a trustworthy money system.

So the backend enforces rules like:

- no negative balances
- no partial transfers
- no silent retries on writes
- exactly-once behavior for duplicate requests
- immutable journal entries
- deterministic policy decisions
- transaction safety across multiple accounts

The backend uses PostgreSQL as the financial authority. That means the app does not decide final balances in Python memory; instead, it writes real ledger entries and updates the authoritative database.

---

## 3. Backend money flow in simple terms

A transfer is not a simple subtraction/addition in the app server.

The backend uses a model based on journal entries.

### What a money transfer looks like

When money is sent:

1. the sender is identified from the JWT
2. the request is validated
3. the same idempotency key is checked
4. policy checks run (balance, daily limits, step-up rules, self-transfer rules)
5. the database locks the involved accounts in a fixed order to avoid deadlocks
6. a transfer record is created
7. journal entries are inserted for debit and credit
8. cached balances are updated
9. the response is returned

This entire sequence is atomic. If something fails after journal insertion but before full completion, the database transaction rolls back so the money does not end up partially moved.

### The real financial truth

The project treats the ledger as the truth.

That is why the logic is not based on a simple `balance` field alone. Instead, each transfer creates journal entries that are mathematically balanced. This keeps the money movement auditable and reviewable.

The backend checks things such as:

- total debits equal total credits
- account balances never go negative
- each transfer has a valid immutable journal trail
- duplicates do not create more money

---

## 4. Important backend concepts

### Authentication

The API uses JWT-based authentication.

The flow is:

- user registers or logs in
- backend verifies PIN securely
- backend issues a JWT
- frontend sends `Authorization: Bearer <token>` on requests

The `auth` router handles:

- `/auth/register`
- `/auth/login`
- `/auth/me`

The registration path also creates a system issuance grant so new users immediately receive their starting balance.

### Lockout and rate limiting

The backend is careful about abuse:

- failed PIN attempts can trigger lockout
- request limits are enforced per IP or user
- login and lookup endpoints are protected by rate limits
- forwarded client IPs are only trusted from configured proxies

This is a reliability and security feature, not just a convenience.

### Idempotency

This is one of the most important backend ideas.

If a user clicks send twice or a retry happens, the backend must not move money twice.

The solution is an idempotency key:

- each user has a unique key for a transfer attempt
- the same key and same payload returns the original result
- a changed payload with the same key is rejected
- the backend stores and replays the result when appropriate

This is critical because a user can accidentally resubmit a payment request or the network can retry a request without the UI realizing it.

### Policy and risk

The app has deterministic financial policies such as:

- minimum and maximum amount checks
- per-transfer limits
- daily total limits
- step-up verification for risky or unusual transfers
- self-transfer rejection
- recipient validation

This is important because a money app cannot rely on vague or opaque rules. The app is designed to explain why a transfer was allowed or rejected.

### Integrity and system health

The project exposes endpoints like:

- `/integrity`
- `/system-info`

These are not generic status pages. They check whether the backend remains financially consistent.

The integrity report verifies things like:

- money is conserved
- balances match ledger totals
- issuance accounts offset user balances
- the ledger remains balanced

This helps judges and reviewers confirm that the app is behaving honestly under pressure.

---

## 5. Frontend: what it is

The frontend is a Next.js app in `web/`.

It is a PWA-like interface for the mobile-money product. The app is built around a calmer fintech style, following the design system in `docs/design-system.md` and route contracts in `docs/frontend-screens.md`.

The current frontend is not a generic dashboard. It is designed to show a very narrow set of user flows:

- sign up / sign in
- view account balance
- view smart-card wallet page
- send money
- review history
- inspect money requests
- show status and integrity information where relevant

The app is deliberately designed around the idea that numbers are authoritative and must be displayed clearly.

### Main frontend structure

The app is organized like this:

- `web/src/app/` — route-level pages and layouts
- `web/src/components/` — reusable UI pieces
- `web/src/lib/api.ts` — API boundary
- `web/src/lib/fixtures.ts` — optional demo data for UI rendering
- `web/src/lib/types.ts` — TypeScript models used by the app

A concrete example is the wallet page at `web/src/app/(app)/wallet/page.tsx`.

That page:

- loads the signed-in user and account
- calls the API for `me` and account data
- shows the current balance
- exposes account details and a protection summary
- renders the app’s financial card design

The page is a good example of how the frontend is meant to behave: read backend truth, render it clearly, and avoid calculating authoritative money state locally.

---

## 6. Frontend-to-backend connection

The main bridge is `web/src/lib/api.ts`.

This file centralizes almost all browser-to-API requests.

It does a few important things:

- uses `NEXT_PUBLIC_API_URL` or defaults to `http://localhost:8080/api/v1`
- stores the JWT in local storage
- sends `Authorization: Bearer <token>`
- adds `Idempotency-Key` on write actions
- converts backend errors into readable user-facing messages
- does not treat the browser as the money source of truth

This file is important because it is the single place where the UI knows how to talk to the backend.

### Example request flow

When the user signs in, the frontend calls:

- `POST /auth/login`

Then on later actions:

- `GET /accounts/me` for account state
- `POST /transfers` for send operations
- `GET /transfers` for history
- `POST /money-requests` for request creation

The app specifically keeps amounts in integer poisha in state and sends them as integer values, not floating-point taka. Display values are formatted only at the UI layer.

---

## 7. Current reality of the project

The repo contains a modern backend and a frontend shell, but they are not fully identical in maturity.

### Backend status

The backend is the most mature and serious part of the project. It contains:

- real API endpoints
- auth and security logic
- financial transaction logic
- database-backed integrity checks
- money request flow
- deterministic transfer policy checks
- reliability-oriented architecture

This is the part that is meant to prove trustworthiness under concurrency and duplicate traffic.

### Frontend status

The frontend is present and structured for the product, but it is clearly designed as a frontend shell and UI layer rather than a fully finished production payment flow.

The repo notes explicitly that the Next.js app is specified and some pieces are implemented, but it is not the main focus of the trust model. The UI is expected to consume the backend’s authoritative responses and render them clearly.

In practice, the frontend currently includes:

- route structure
- design system styling
- wallet/account presentation
- client-side API interactions
- fixture mode for UI work without backend availability

The current code intentionally uses fixture mode when enabled, but the project documentation makes it clear that fixture mode must not be treated as financial truth.

---

## 8. How the whole system works together

A normal user journey looks like this:

1. User opens the app
2. Frontend loads the wallet/account page
3. Frontend requests account and user info from the backend
4. Backend reads the authenticated user and corresponding account from PostgreSQL
5. User decides to send money
6. Frontend forms an intention and sends a request with an idempotency key
7. Backend verifies the sender, performs policy checks, and writes the transaction atomically
8. Backend returns a receipt or transfer result
9. Frontend displays the final status and keeps the receipt in the UI

This is the correct mental model for the project: the frontend is a trusted interface, but the backend is the authority.

---

## 9. Why this design matters

This architecture is valuable because it protects the system from the most common financial failures:

- duplicate sends
- lost balance updates
- half-completed transfers
- race conditions
- unsafe client-side balance logic
- incorrect retries
- hidden policy mistakes

If the app had enforced balance logic in the browser, it would be easy to fake or bypass. This project intentionally avoids that. The money path is routed through the backend and the ledger.

---

## 10. Short summary

The current project has two main parts:

- Frontend: a polished Next.js wallet experience that renders user account data and money flows in a human-friendly way
- Backend: a strict FastAPI money engine that enforces identity, policy, atomic transfers, ledger integrity, idempotency, and database-backed truth

The backend is the real engine behind the product. The frontend exists to present the truth in a clean, trustworthy interface and to collect user intent without ever becoming the authority on money movement.

This is exactly the right model for a serious fintech-style demo: the client is a shell, the backend is the financial source of truth.
