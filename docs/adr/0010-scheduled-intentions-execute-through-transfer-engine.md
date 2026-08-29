# Scheduled intentions execute through the Transfer engine

A Scheduled Transfer is a PIN-authorized instruction to attempt a transfer no
earlier than a specified time. Creating one does not reserve funds, create a
Transfer, or write Journal Entries. The UI must say that balance and policy are
checked again when the instruction becomes due.

The worker claims one due row with `FOR UPDATE SKIP LOCKED` and executes it through
the same atomic, idempotent Transfer engine used by interactive sends. The row
lock, Journal Entries, Transfer, schedule status, and notifications commit in one
database transaction. Multiple workers therefore cannot execute one instruction
concurrently. A crash rolls the transaction back and releases the row; the next
claim uses the same deterministic Idempotency-Key.

The creator confirms the instruction with their PIN when it is created. The PIN
is verified and discarded; no credential is stored. This pre-authorization may
satisfy a step-up decision at execution, but all objective checks still run at
execution: account locks, current balance, daily limits, recipient existence, and
risk assessment. A business rejection becomes one explicit `FAILED` state with
the reason and is not automatically retried. Infrastructure failure leaves the
instruction scheduled because its transaction did not commit.

This lifecycle is deliberately separate from Transfer status. There is no
"pending money" in the Ledger.
