# web/ — handoff

Written 29 Aug 2026, after the frontend branch was merged into `main` and rewired onto the shipped
backend contract. Everything below was checked against disk and against the running stack at the
time of writing.

## Build state — GREEN

`npm run build` compiles and type-checks; `npm run lint` is clean. 21 routes are emitted.

## The contract

`docs/openapi.json` is the contract. `docs/frontend-integration.md` explains lifecycle and retry
meaning. Local base URL `http://localhost:8080/api/v1`, overridden by `NEXT_PUBLIC_API_URL`.

The frontend was originally written against the speculative contract in `docs/solution-prd` §26–27,
which differs from what shipped on almost every path and field. That gap is now closed in one place:

- `src/lib/types.ts` holds **wire types** (`*Poisha`, exactly what the API sends) and **view models**
  (`*Minor`, what components render). `Minor` is a rename of poisha, never a conversion.
- `src/lib/api.ts` is the only module that may import a wire type. Every backend field name appears
  there and nowhere else, so a backend rename is one mapper edit rather than a sweep.

Do not add an endpoint path or a `*Poisha` field to a component. If a screen needs new data, add a
method plus a mapper to `lib/api.ts`.

## Things that will bite you

**Step-up fires on the first send to any new recipient**, not only above ৳25,000. The policy is
≥ ৳25,000, first-time recipient, or ≥5 transfers in 10 minutes. `POST /transfers` answers
`403 STEP_UP_REQUIRED` with `error.stepUpReason`; resubmit **the same body and the same
Idempotency-Key** with `pin`. `StepUpDialog` is wired into `/send`, `/send/group`, request
payment, Group Settlement, and Scheduled Transfer creation. A send flow that does not handle this
fails on its first demo attempt.

**One idempotency key per compose session.** Generated with `newIdempotencyKey()` when the screen
mounts, resent unchanged on every attempt including the step-up retry — a PIN is more proof of the
same intention, not a new transfer. `POST /money-requests` needs one too.

**`GET /transfers` returns the viewer's own leg**, signed: negative when sent. The mapper takes the
magnitude and carries direction in `direction`. A group send returns every recipient in
`counterparties`.

**Money requests are direction-scoped server-side.** `GET /money-requests?direction=incoming|outgoing`
is a query, not a client-side filter.

## Shipped extension surfaces

`/smart-wallet`, `/groups`, `/notifications`, `/scheduled`, and consent Reversals are live API-backed
features. Smart Wallet cash is deliberately separate from the conserved digital Ledger. Expense
Groups calculate an explainable plan, but each payer approves only their own outgoing Transfer.
Scheduled rows are future instructions, never pending money; the worker rechecks balance and policy
when due. Reversals are consent requests that create a new compensating Transfer.

`lib/fixtures.ts` and `lib/admin-demo.ts` are deleted. `/admin` reads live `GET /integrity` and
`GET /system-info` every 5s and shows an explicit "no verdict available" state when the core is
unreachable — it never falls back to a plausible number.

## Read these first

1. `docs/design-system.md` — tokens, measured contrast, colour law. **Every hex is declared once, in
   `src/app/globals.css`.** Four palette values failed WCAG AA and are corrected there; do not
   restore the originals without re-measuring.
2. `docs/frontend-screens.md` — screens, states, responsive rules.
3. `docs/frontend-integration.md` — endpoint map, safe write flow, error handling.
