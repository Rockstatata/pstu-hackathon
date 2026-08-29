# Deterministic lock ordering instead of deadlock retry

Before locking, a transfer collects every account it will touch, sorts them by account ID ascending,
and locks in that order. This applies uniformly to one-to-one transfers, group transfers, and
reversals.

A global lock ordering makes deadlock structurally impossible rather than merely unlikely, which is a
better answer than a retry loop when asked how we know. We deliberately did **not** add deadlock
retry: if the ordering is correct the retry is dead code, and if it is wrong the retry hides the bug.
A `lock_timeout` is set so pathological waits fail fast rather than hanging a request.
