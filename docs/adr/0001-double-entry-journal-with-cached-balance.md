# Double-entry journal with a cached balance column

Every money movement is written as immutable journal entries summing to zero, and the same
transaction also updates a `balance` column on each affected account. The redundancy is deliberate:
the balance column gives us a single row to lock and a cheap read, while the journal gives us an
independent source of truth to check it against.

## Considered Options

Deriving balance by `SUM()` over the journal at read time is purer but degrades under load and gives
the reconciliation checker nothing to compare against. A mutable balance with a plain transfer log is
fast but has no independent record, so "how do we know money wasn't lost?" has no answer.

## Consequences

The two representations can drift, so they must always be written in the same transaction, and the
integrity check asserting `SUM(journal legs) = balance` per account is not optional — it is the thing
that makes the redundancy worth having.
