# API Contract

Base URL: `/api/v1` — locally `http://localhost:8080/api/v1` (through the nginx gateway).
Interactive docs: `/api/v1/docs`.

Money is **integer poisha** in every request and response. `250000` is ৳2,500.00.
Never send or expect a decimal taka value.

---

## Conventions

**Auth.** `Authorization: Bearer <jwt>` on everything except register, login, and the
system endpoints. Never a cookie — ADR-0007, the frontend is a different origin.

**Field names.** Responses are always camelCase. Requests accept **both** camelCase and
snake_case aliases where the schema declares them. Unknown fields and mixed one-to-one/group
Transfer forms are rejected. Request bodies are limited to 32 KiB.

**The sender is never in the request body.** It is resolved from the token. A body that
names its own sender would let a client spend someone else's money.

**Errors** are always this shape, with an HTTP status that matches:

```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "You have BDT 500.00, which is not enough to send BDT 2,500.00.", "traceId": "a1b2c3d4e5f6" } }
```

`message` is a sentence written for a person and is safe to show directly in the UI.
`code` is what you branch on. Never show `code` to a user.

**Response headers on every reply:** `X-Trace-Id`, `X-Instance` (which API replica served
it), and `X-Served-By` (added by the gateway). All three are CORS-exposed.

---

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_REQUEST` | 422 | Malformed body; `message` names the problem |
| `INVALID_AMOUNT` | 400 | Amount ≤ 0 |
| `TRANSFER_LIMIT_EXCEEDED` | 400 | Over ৳100,000 per transfer or ৳200,000 per day |
| `INSUFFICIENT_FUNDS` | 400 | Balance too low. **Correct rejection, not a failure** |
| `SELF_TRANSFER_NOT_ALLOWED` | 400 | Recipient is the sender |
| `RECIPIENT_NOT_FOUND` | 404 | No account for that phone. In a group, nobody was paid |
| `STEP_UP_REQUIRED` | 403 | Resubmit with `pin`. Body carries `stepUpReason` |
| `STEP_UP_FAILED` | 403 | Wrong PIN |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Missing `Idempotency-Key` header |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different payload |
| `REQUEST_IN_PROGRESS` | 409 | Key claimed but no response stored yet |
| `PHONE_ALREADY_REGISTERED` | 409 | Registration collision |
| `UNAUTHENTICATED` | 401 | Missing, invalid, or expired token |
| `TRANSFER_NOT_FOUND` | 404 | No transfer with that reference **that you have a leg in** |
| `MONEY_REQUEST_NOT_FOUND` | 404 | Unknown request, or one the caller is not allowed to see |
| `MONEY_REQUEST_NOT_PENDING` | 409 | A conflicting action targeted a terminal request |
| `MONEY_REQUEST_EXPIRED` | 409 | The pending request passed its fixed 24-hour expiry |
| `RATE_LIMITED` | 429 | Cross-replica limit reached; obey `Retry-After` |
| `PAYLOAD_TOO_LARGE` | 413 | Request body exceeds 32 KiB |
| `FINANCIAL_CORE_UNAVAILABLE` | 503 | PostgreSQL or the financial API tier is unavailable; outcome may be uncertain |
| `INTERNAL_ERROR` | 500 | Unexpected server fault; inspect history before retrying a write |

> For load tests: everything except `INTERNAL_ERROR` and non-JSON responses is the system
> working correctly. `INSUFFICIENT_FUNDS` under a double-spend storm is the pass condition.

---

## Auth

### `POST /auth/register` → 201

```json
{ "name": "Ayesha Rahman", "phone": "01712345678", "pin": "48213" }
```

Phone must match `01[3-9]XXXXXXXX`. `+880` prefix is accepted and normalised. PIN is exactly 5 digits.

```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": "uuid", "name": "Ayesha Rahman", "phone": "01712345678" },
  "grant": { "amountPoisha": 10000000, "reference": "TXNK7M2QP9XRT4" }
}
```

**Returns the token directly — no separate login needed.** Registration and the ৳100,000
issuance commit in one transaction.

### `POST /auth/login` → 200

```json
{ "phone": "01712345678", "pin": "48213" }
```

Returns `{ "token", "user" }`. Wrong phone and wrong PIN give the identical 401.

### `GET /auth/me` → 200 · `{ "id", "name", "phone" }`

---

## Accounts and recipients

### `GET /accounts/me` → 200

```json
{ "accountId": "uuid", "balancePoisha": 10000000, "currency": "BDT", "asOf": "2026-08-29T11:04:22Z" }
```

`asOf` is what the offline banner shows as "last updated".

### `GET /users/lookup?phone=01712345678` → 200

The Recipient Verification lookup behind screen C2.

```json
{ "name": "Ayesha Rahman", "maskedPhone": "017*****678" }
```

404 `RECIPIENT_NOT_FOUND` if unregistered. 400 `SELF_TRANSFER_NOT_ALLOWED` for your own number.
Returns no balance and no user id — it must not be a directory to scrape.

### `GET /users/recent-recipients` → 200 · `{ "recipients": [{ "name", "phone", "maskedPhone" }] }`

Up to 6, most recent first. Feeds the C1 shortcut row.

---

## Transfers

### `POST /transfers` → 201

**`Idempotency-Key: <uuid v4>` is required.** Generate it on the client *before* the first
attempt and reuse it for every retry of that same intention.

One-to-one:

```json
{ "recipientPhone": "01712345678", "amountPoisha": 250000, "note": "Lunch" }
```

Group (ADR-0002, all-or-nothing):

```json
{ "recipients": [ { "phone": "01712345678", "amountPoisha": 100000 },
                  { "phone": "01812345678", "amountPoisha": 150000 } ],
  "note": "Trip split" }
```

A Group Transfer accepts at most 20 submitted recipients. Every submitted amount
must be positive; duplicate phone numbers are merged only after that validation.

The frontend may send `"pin": "48213"` on the first attempt. If it waits for a 403
`STEP_UP_REQUIRED`, it must retry with the same Idempotency-Key.

```json
{
  "transferId": "uuid",
  "reference": "TXNK7M2QP9XRT4",
  "kind": "P2P",
  "status": "COMPLETED",
  "totalPoisha": 250000,
  "note": "Lunch",
  "riskReason": null,
  "senderBalanceAfterPoisha": 9750000,
  "completedAt": "2026-08-29T11:04:22Z",
  "recipients": [ { "name": "Ayesha Rahman", "maskedPhone": "017*****678", "amountPoisha": 250000 } ]
}
```

#### Idempotency

`X-Idempotent-Replay: true | false` on every 201. `false` means this call committed the
money; `true` means it returned a stored response and moved nothing.

- **Same key, same payload** → the original 201 body, byte for byte, with `X-Idempotent-Replay: true`.
  `transferId` and `reference` are identical across all replays. 50 concurrent calls → 1 transfer, 49 replays.
- **Same key, different payload** → 409 `IDEMPOTENCY_KEY_REUSED`.
- **`pin` is excluded from the payload fingerprint**, so a step-up retry reuses the same key
  rather than being rejected as a different request.
- **A rejected transfer releases its key.** `INSUFFICIENT_FUNDS` rolls the reservation back
  with the money, so the same key is reusable for a genuine retry.

### `GET /transfers?limit=50&direction=sent|received` → 200

```json
{ "transactions": [ {
  "reference": "TXNK7M2QP9XRT4", "kind": "P2P", "status": "COMPLETED",
  "note": "Lunch", "riskReason": null,
  "direction": "sent", "amountPoisha": -250000,
  "createdAt": "2026-08-29T11:04:22Z",
  "counterparties": [ { "name": "Ayesha Rahman", "maskedPhone": "017*****678", "amountPoisha": 250000 } ]
} ] }
```

`amountPoisha` is **signed from your point of view** — negative sent, positive received.
Read straight from the Ledger, so each recipient of a Group Transfer sees their own leg,
not the sender's total.

### `GET /transfers/{reference}` → 200

Same object plus `reversible`, `notReversibleReason`, and any linked Reversal request. The original
sender may request Reversal only for a completed one-to-one Transfer. Approval creates a new
compensating `REVERSAL` Transfer and marks the original `REVERSED`; no Journal Entry is edited.

---

## Money Requests

A Money Request is a 24-hour consent workflow, not money in motion. `EXPIRED` is derived when
a pending row passes `expiresAt` and is checked again under lock before every state change.
Unknown and unauthorized IDs both return 404.

### `POST /money-requests` → 201

Requires `Idempotency-Key`.

```json
{ "payerPhone": "01812345678", "amountPoisha": 125000, "reason": "Dinner split" }
```

```json
{
  "requestId": "uuid", "reference": "REQK7M2QP9XRT4", "direction": "outgoing",
  "status": "PENDING", "amountPoisha": 125000, "reason": "Dinner split",
  "requester": { "name": "Ayesha", "maskedPhone": "017*****678" },
  "payer": { "name": "Farhan", "maskedPhone": "018*****678" },
  "transferReference": null,
  "createdAt": "2026-08-29T11:04:22Z", "expiresAt": "2026-08-30T11:04:22Z",
  "resolvedAt": null
}
```

### `GET /money-requests?direction=incoming|outgoing&status=...&limit=50` → 200

`status` is one of `PENDING`, `PAID`, `DECLINED`, `CANCELLED`, or `EXPIRED`; `limit` is 1–100.
Returns `{ "moneyRequests": [...] }`. `GET /money-requests/{id}` returns one resource.

### `POST /money-requests/{id}/pay` → 201

Requires `Idempotency-Key`; body is `{ "pin": "54321" }` when Step-Up applies. Payment locks
the request and invokes the normal Transfer engine in the same transaction. The Transfer receipt
adds `moneyRequestId` and `moneyRequestReference`. Same-key replay returns the stored receipt with
`X-Idempotent-Replay: true`; different-key double payment returns 409.

### `POST /money-requests/{id}/decline` · `POST /money-requests/{id}/cancel` → 200

Only the payer may decline and only the requester may cancel. Repeating the same terminal action
returns the same resource; a conflicting terminal transition returns 409.

---

## Reversals, Notifications, and Scheduled Transfers

### `POST /transfers/{reference}/reversal-request` -> 201

Requires `Idempotency-Key`. The original sender of an eligible one-to-one Transfer creates a
Money Request with `requestKind: "REVERSAL"`. The original recipient must pay that request; payment
creates a compensating Transfer with `kind: "REVERSAL"`. Group Transfers and Reversals cannot be
reversed again.

### `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`

Notifications are scoped to the authenticated User. Money-received notifications commit in the
same transaction as their Journal Entries; request and schedule events commit with their state
change. `GET` returns `notifications` and the authoritative `unreadCount`.

### `POST /scheduled-transfers` -> 201

Requires `Idempotency-Key` and a Step-Up `pin`. Body fields are `recipientPhone`, `amountPoisha`,
`executeAt`, and optional `note`. Creation writes a `SCHEDULED` intention only: no Transfer, fund
reservation, or Journal Entry. The worker claims due rows with `FOR UPDATE SKIP LOCKED`, reruns all
Transfer checks, and records `EXECUTED` with `transferReference` or one terminal `FAILED` reason.
List with `GET /scheduled-transfers`; cancel a pending instruction with `POST .../{id}/cancel`.

---

## Smart Wallet and Shared Expenses

`GET /smart-wallet` returns Expected Cash and append-only activity. Connection simulation, Cash
Events, and Cash Count Reconciliation update only the physical Cash Inventory Journal; they never
change the digital Ledger.

`/expense-groups` records immutable Expenses and Shares. `GET .../settlement-plan` returns current
Net Positions and a deterministic practical plan. `POST .../settle` executes only the signed-in
payer's outgoing instructions through the Transfer engine and rejects a stale `planVersion`.

---

## Financial Outlook — authenticated, read-only

### `GET /financial-outlook` → 200

Returns Account Balance, month-to-date money in/out, the same elapsed portion of the previous month,
up to three eligible complete months of Typical Money Out, an estimated Account buffer, the largest
recipient, and six monthly history buckets. Registration issuance is excluded. All amounts remain
integer poisha; percentage changes and recipient shares are integer basis points, and buffer months
are integer hundredths.

The response includes the exact comparison, baseline, and band rules used. `NO_BASELINE` and null
values are expected for new Accounts. This endpoint never creates a Transfer, future instruction,
goal, classification, or AI request.

---

## System — no auth required

### `GET /health/live` · `GET /health/ready`

Liveness does not touch the database on purpose: a database blip must not restart three
healthy replicas. Readiness does, and returns 503 when it cannot reach Postgres.

### `GET /integrity` → 200 — the judge-facing report

Computed live on every call, never cached.

```json
{
  "verdict": "HEALTHY",
  "assertions": [ { "key": "ledger_sums_to_zero", "label": "Every taka debited was credited somewhere", "value": 0, "pass": true } ],
  "counters": { "completedTransfers": 128, "idempotentReplays": 49, "rejectedOverspends": 10,
                "stepUpsTriggered": 3, "policyRejections": 1, "registeredUsers": 12, "journalEntries": 268 },
  "totals": { "issuedPoisha": 120000000, "heldPoisha": 120000000, "differencePoisha": 0 },
  "instance": "a1b2c3d4e5f6"
}
```

**Every assertion is written so that `0` is healthy**, so the pass rule is one line with no
per-check special case. `verdict` is `HEALTHY` only when all five pass.

### `GET /system-info` → 200

Returns the live policy plus `expectedReplicas`, `healthyReplicas`, a 15-second freshness window,
overall `health`, and every instance's `lastSeen`/`healthy` state. Use policy values in the UI
rather than hardcoding them.

## Operational limits

- Login: 20 attempts per sanitized client IP per minute.
- Recipient lookup: 60 requests per authenticated User per minute.
- Money Request creation: 20 requests per authenticated User per minute.
- A 429 includes `Retry-After` and `retryAfterSeconds`.
- If a write loses contact with the financial core, do not mint a new key. Inspect history and
  retry the same intention only with its original Idempotency-Key.

---

## Notes for the load tests

- Replicas land as `pstu-money-api-1|2|3`. `docker compose kill api` stops **all three**;
  to kill one, use `docker kill pstu-money-api-2`.
- The gateway sets `proxy_next_upstream off`, so a POST is never silently replayed onto a
  second replica by nginx.
- `lock_timeout` is 3s. Under a deliberate deadlock-pressure scenario a request fails fast
  rather than hanging; that is the designed behaviour (ADR-0003), not a bug.
