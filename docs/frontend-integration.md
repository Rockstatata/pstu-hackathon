# Frontend Integration

Use `docs/openapi.json` as the machine-readable contract and `docs/api-contract.md` for lifecycle
and retry meaning. The local base URL is `http://localhost:8080/api/v1`.

## Screen-to-Endpoint Map

| Frontend capability | Endpoint(s) |
|---|---|
| Register / sign in | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Home balance | `GET /accounts/me` |
| Recipient verification | `GET /users/lookup`, `GET /users/recent-recipients` |
| Direct / Group Send | `POST /transfers` |
| History / receipt | `GET /transfers`, `GET /transfers/{reference}` |
| Request inbox / outbox | `GET /money-requests?direction=incoming|outgoing` |
| Create / inspect request | `POST /money-requests`, `GET /money-requests/{id}` |
| Pay / decline / cancel | `POST .../pay`, `POST .../decline`, `POST .../cancel` |
| Integrity / replica status | `GET /integrity`, `GET /system-info` |

Notifications, scheduled Transfers, and consent-based Reversals are outside this release. Hide
those controls. Transfer detail always returns `reversible: false` with a release explanation.

## Tokens, Amounts, and CORS

Keep the JWT in application memory where practical and send `Authorization: Bearer <token>`; the
API does not use auth cookies. Clear it on 401. Never log the token or a PIN.

Amounts are integer poisha. Format `amountPoisha / 100` for display with exactly two fraction
digits, but keep integer poisha in state and requests. Never use a floating-point taka result as an
authoritative amount.

The API permits configured origins and exposes `X-Trace-Id`, `X-Instance`, `X-Served-By`, and
`X-Idempotent-Replay`. Local frontend origin is `http://localhost:3000`.

## Safe Write Flow

1. Create a UUID idempotency key when the user confirms an intention.
2. Keep that key with the pending UI operation until a definitive response.
3. Send PIN on the first attempt when available, or handle `403 STEP_UP_REQUIRED` by showing the
   reason and resubmitting the same body/key with `pin`.
4. On network failure or `503 FINANCIAL_CORE_UNAVAILABLE`, do not report failure as final. Check
   history/request detail and retry only with the same key.
5. Treat `X-Idempotent-Replay: true` as success using the returned original receipt.

```ts
const key = crypto.randomUUID();
const response = await fetch(`${api}/transfers`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": key,
  },
  body: JSON.stringify({ recipientPhone, amountPoisha, pin }),
});
```

## Money Request UI Rules

`direction` is relative to the signed-in User: outgoing means requester, incoming means payer.
Render `EXPIRED` from the server like a terminal state. Only show Pay/Decline for incoming pending
requests and Cancel for outgoing pending requests. Payment returns a normal Transfer receipt plus
`moneyRequestId` and `moneyRequestReference`; navigate to the receipt with that response.

## Errors

Branch on `error.code` and show `error.message`. For 429, disable the action until `Retry-After`
elapses. For 404 request/Transfer lookups, use one generic not-found screen. Attach `traceId` to a
support/debug affordance, not the primary message. Client validation should improve feedback, but
the server response remains authoritative.
