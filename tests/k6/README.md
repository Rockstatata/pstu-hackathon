# The failure laboratory

Five scenarios. Each one targets a specific way a money system loses money, and each maps to a
counter on the integrity dashboard.

> **Status: bound to `docs/api-contract.md`, imports verified, not yet run against a live API.**
> Every path, field name, status code and error code lives in [lib/config.js](lib/config.js) — if a
> backend change breaks a scenario, the fix almost certainly belongs in that one file. All five
> scripts have been parsed and their imports resolved against stubbed k6 modules, so they will load;
> nothing has executed against a running stack yet.

## Step-Up is on the happy path here

Worth knowing before reading any scenario: Step-Up fires on a transfer **≥ ৳25,000**, on a
**first-time recipient**, or on **5 transfers in 10 minutes**. Every scenario below trips at least
one of those, so essentially every transfer returns `403 STEP_UP_REQUIRED` before it can commit.

`transfer()` in [lib/api.js](lib/api.js) handles it the way a correct client does — resubmit with the
PIN under the **same** Idempotency-Key, because the PIN is excluded from the payload fingerprint and
it is the same intention, not a new one. It also handles `409 REQUEST_IN_PROGRESS` by waiting and
re-asking rather than minting a fresh key, which would be a second movement.

| # | Scenario | Proves | Dashboard counter |
|---|---|---|---|
| 1 | [Duplicate storm](01-duplicate-storm.js) | 50 identical requests with one `Idempotency-Key` move money exactly once | Idempotent replays |
| 2 | [Double-spend](02-double-spend.js) | 20 concurrent ৳100 sends from ৳1,000 → exactly 10 succeed, balance lands on 0 | Rejected overspends |
| 3 | [Deadlock pressure](03-deadlock-pressure.js) | Bidirectional A↔B traffic never deadlocks (ADR-0003) | — |
| 4 | [Sustained load](04-sustained-load.js) | Throughput across all 3 replicas, ledger balanced after | Completed transfers |
| 5 | [Replica kill](05-replica-kill.js) | SIGKILL a replica mid-flight → no money lost | — |

## Running

Against the local stack:

```bash
docker compose --profile chaos up -d
docker compose run --rm k6 run /scripts/01-duplicate-storm.js
```

Against the deployed API:

```bash
k6 run -e BASE_URL=https://<fqdn>/api/v1 tests/k6/01-duplicate-storm.js
```

All five, in order:

```bash
for f in tests/k6/0*.js; do k6 run -e BASE_URL="$BASE_URL" "$f" || break; done
```

## Reading the results

Each scenario asserts through **thresholds**, so k6 exits non-zero on failure — no eyeballing
required. The `teardown` of each prints a one-line verdict.

The important distinction in scenario 5: **errors are expected, lost money is not.** Killing a replica
*should* break the requests that were in flight on it. `http_req_failed` is deliberately permissive
there; the assertion that matters is that the pool's total balance is unchanged.

## What these do not prove

- **Network partitions and latency injection.** Toxiproxy was cut for time (see the Q1 tier decision
  in the design session). These scenarios kill processes; they do not degrade links.
- **Multi-node failover.** One Postgres writer, one VM. The replicas are stateless app instances, not
  a distributed database, and we deliberately do not claim otherwise (`docs/adr/0001`).
- **Anything about 10M users.** These run at tens of VUs. They demonstrate *correctness properties*
  under concurrency, not scale.

Being straight about this is worth more than an inflated claim — the brief asks the team to defend
its engineering decisions, and overstating what a load test proves is the fastest way to lose that
exchange.
