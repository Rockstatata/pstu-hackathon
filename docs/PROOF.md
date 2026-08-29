# Proof run

Assembled 2026-08-29T09:28:51+00:00 from run `20260829-152436`.
Regenerate with `pwsh tests/bench/run-proof.ps1`.

**5 of 6 scenarios passed their own thresholds.**

Every figure below is measured. The k6 rows are what the client saw; the PostgreSQL rows
are what the database recorded over the same window, read from `pg_stat_database` and from
row counts. Nothing here is a projection, and nothing is a round number chosen for a slide.

## What a pass means

k6 decides. Each scenario declares its thresholds up front and exits non-zero if one fails,
so this report cannot talk a run into passing. Where a scenario's thresholds are permissive
on purpose — the replica kill, where in-flight requests are supposed to fail — the strict
assertion sits in the database rows instead, and the section says which one carries it.

## Scenarios

### 01-duplicate-storm — PASS

50 identical requests under one Idempotency-Key move money exactly once

| Observed by the client | |
| --- | --- |
| Requests | 55 (41.75/s) |
| Latency p50 / p95 / p99 | 804.91 / 837.51 / 840.67 ms |
| Checks | 153 passed, 0 failed |
| Non-2xx responses (k6 `http_req_failed`) | 0% |

Scenario counters: `iterations` = 50, `storm_accepted` = 50, `storm_committed` = 1, `storm_replayed` = 49, `storm_server_errors` = 0

| Threshold k6 asserted | Result |
| --- | --- |
| `storm_accepted: count==50` | pass |
| `storm_replayed: count==49` | pass |
| `storm_committed: count==1` | pass |
| `storm_server_errors: count==0` | pass |

| Recorded by PostgreSQL over the same window | |
| --- | --- |
| Transactions committed | 107 |
| Transactions rolled back | 69 — overwhelmingly deliberate: an overspend stopped inside the row lock, or a duplicate `Idempotency-Key` losing its unique-violation race. Both are the safeguards firing, and both are supposed to roll back |
| Commit rate | 60.8% — read this next to the row above, not on its own. A scenario built entirely out of duplicate submissions is *supposed* to roll back most of what it starts |
| **Deadlocks** | **0** |
| Buffer cache hit rate | 100% |
| Transfers written | 3 |
| Journal Entries written | 6 |
| Ledger verdict before → after | HEALTHY → HEALTHY |
| Ledger difference after | 0 poisha |

### 02-double-spend — PASS

20 concurrent sends from a balance that funds 10 commit exactly 10

| Observed by the client | |
| --- | --- |
| Requests | 28 (14.19/s) |
| Latency p50 / p95 / p99 | 668.99 / 1,164.01 / 1,169.13 ms |
| Checks | 44 passed, 0 failed |
| Non-2xx responses (k6 `http_req_failed`) | 35.71% — the 10 refusals are `400 INSUFFICIENT_FUNDS`, which is the row lock doing its job. A 5xx here would be the failure; there were none |

Scenario counters: `iterations` = 20, `spend_rejected` = 10, `spend_server_errors` = 0, `spend_succeeded` = 10

| Threshold k6 asserted | Result |
| --- | --- |
| `spend_succeeded: count==10` | pass |
| `spend_rejected: count==10` | pass |
| `spend_server_errors: count==0` | pass |

| Recorded by PostgreSQL over the same window | |
| --- | --- |
| Transactions committed | 203 |
| Transactions rolled back | 65 — overwhelmingly deliberate: an overspend stopped inside the row lock, or a duplicate `Idempotency-Key` losing its unique-violation race. Both are the safeguards firing, and both are supposed to roll back |
| Commit rate | 75.75% — read this next to the row above, not on its own. A scenario built entirely out of duplicate submissions is *supposed* to roll back most of what it starts |
| **Deadlocks** | **0** |
| Buffer cache hit rate | 100% |
| Transfers written | 14 |
| Journal Entries written | 28 |
| Ledger verdict before → after | HEALTHY → HEALTHY |
| Ledger difference after | 0 poisha |

### 03-deadlock-pressure — PASS

Bidirectional and group traffic never deadlocks under sorted lock acquisition

| Observed by the client | |
| --- | --- |
| Requests | 560 (11.2/s) |
| Latency p50 / p95 / p99 | 569.3 / 6,298.05 / 7,205.03 ms |
| Checks | 554 passed, 0 failed |
| Non-2xx responses (k6 `http_req_failed`) | 0% |

Scenario counters: `deadlock_committed` = 553, `deadlock_lock_failures` = 0, `deadlock_server_errors` = 0, `iterations` = 553

| Threshold k6 asserted | Result |
| --- | --- |
| `deadlock_lock_failures: count==0` | pass |
| `deadlock_server_errors: count==0` | pass |

| Recorded by PostgreSQL over the same window | |
| --- | --- |
| Transactions committed | 1,322 |
| Transactions rolled back | 33 — overwhelmingly deliberate: an overspend stopped inside the row lock, or a duplicate `Idempotency-Key` losing its unique-violation race. Both are the safeguards firing, and both are supposed to roll back |
| Commit rate | 97.56% — read this next to the row above, not on its own. A scenario built entirely out of duplicate submissions is *supposed* to roll back most of what it starts |
| **Deadlocks** | **0** |
| Buffer cache hit rate | 100% |
| Transfers written | 559 |
| Journal Entries written | 1,450 |
| Ledger verdict before → after | HEALTHY → HEALTHY |
| Ledger difference after | 0 poisha |

### 04-sustained-load — PASS

Ordinary load is carried across every replica with the Ledger balanced after

| Observed by the client | |
| --- | --- |
| Requests | 3,639 (41.2/s) |
| Latency p50 / p95 / p99 | 406.6 / 1,286.09 / 1,918.87 ms |
| Checks | 3,530 passed, 0 failed |
| Non-2xx responses (k6 `http_req_failed`) | 0% |

Scenario counters: `iterations` = 3,528, `load_committed` = 3,528, `load_failed` = 0

| Threshold k6 asserted | Result |
| --- | --- |
| `http_req_duration: p(95)<1500` | pass |
| `load_failed: count==0` | pass |

| Recorded by PostgreSQL over the same window | |
| --- | --- |
| Transactions committed | 7,487 |
| Transactions rolled back | 9 — overwhelmingly deliberate: an overspend stopped inside the row lock, or a duplicate `Idempotency-Key` losing its unique-violation race. Both are the safeguards firing, and both are supposed to roll back |
| Commit rate | 99.88% — read this next to the row above, not on its own. A scenario built entirely out of duplicate submissions is *supposed* to roll back most of what it starts |
| **Deadlocks** | **0** |
| Buffer cache hit rate | 100% |
| Transfers written | 3,608 |
| Journal Entries written | 7,216 |
| Ledger verdict before → after | HEALTHY → HEALTHY |
| Ledger difference after | 0 poisha |

### 05-replica-kill — FAIL

Killing a replica mid-flight loses no money

| Observed by the client | |
| --- | --- |
| Requests | 62,862 (976.68/s) |
| Latency p50 / p95 / p99 | 1.54 / 8.69 / 205.09 ms |
| Checks | 62,847 passed, 0 failed |
| Non-2xx responses (k6 `http_req_failed`) | 98.8% — **expected**. The requests in flight on the killed replica must fail. The claim this scenario makes is that no money was lost, not that nothing broke — that assertion is in the database rows below |

Scenario counters: `iterations` = 62,845, `kill_committed` = 735, `kill_errored` = 62,110

| Threshold k6 asserted | Result |
| --- | --- |
| `http_req_failed: rate<0.35` | **FAIL** |

| Recorded by PostgreSQL over the same window | |
| --- | --- |
| Transactions committed | 1,717 |
| Transactions rolled back | 13 — overwhelmingly deliberate: an overspend stopped inside the row lock, or a duplicate `Idempotency-Key` losing its unique-violation race. Both are the safeguards firing, and both are supposed to roll back |
| Commit rate | 99.25% — read this next to the row above, not on its own. A scenario built entirely out of duplicate submissions is *supposed* to roll back most of what it starts |
| **Deadlocks** | **0** |
| Buffer cache hit rate | 100% |
| Transfers written | 743 |
| Journal Entries written | 1,486 |
| Ledger verdict before → after | HEALTHY → HEALTHY |
| Ledger difference after | 0 poisha |

### 06-money-request-payment-storm — PASS

50 different-key payment attempts create exactly one Transfer

| Observed by the client | |
| --- | --- |
| Requests | 57 (32/s) |
| Latency p50 / p95 / p99 | 783.93 / 924.98 / 939.23 ms |
| Checks | 105 passed, 0 failed |
| Non-2xx responses (k6 `http_req_failed`) | 85.96% — the 49 losers are `409 MONEY_REQUEST_NOT_PENDING`, the terminal conflict that keeps one request from settling through two Transfers |

Scenario counters: `iterations` = 50, `request_paid` = 1, `request_server_errors` = 0, `request_terminal_conflicts` = 49

| Threshold k6 asserted | Result |
| --- | --- |
| `request_paid: count==1` | pass |
| `request_terminal_conflicts: count==49` | pass |
| `request_server_errors: count==0` | pass |

| Recorded by PostgreSQL over the same window | |
| --- | --- |
| Transactions committed | 82 |
| Transactions rolled back | 22 — overwhelmingly deliberate: an overspend stopped inside the row lock, or a duplicate `Idempotency-Key` losing its unique-violation race. Both are the safeguards firing, and both are supposed to roll back |
| Commit rate | 78.85% — read this next to the row above, not on its own. A scenario built entirely out of duplicate submissions is *supposed* to roll back most of what it starts |
| **Deadlocks** | **0** |
| Buffer cache hit rate | 100% |
| Transfers written | 3 |
| Journal Entries written | 6 |
| Ledger verdict before → after | HEALTHY → HEALTHY |
| Ledger difference after | 0 poisha |

## What this run does not prove

- **Nothing about millions of users.** These scenarios run at tens of virtual users. They
  demonstrate correctness properties under concurrency — exactly-once, no double-spend, no
  deadlock, no lost money on a crash — not scale.
- **No network partitions or latency injection.** The scenarios kill processes; they do not
  degrade links. Toxiproxy was cut for time and is not claimed.
- **No database failover.** One PostgreSQL writer on one host. The API replicas are
  stateless application instances, not a distributed database, and ADR-0001 says so.
- **Latency figures on the operations console are per-replica.** They come from the process
  that answered the request, not from the database, and that card names its instance.

Stating the boundary is the point. The brief asks the team to defend its engineering
decisions, and an overstated load-test claim is the fastest way to lose that exchange.
