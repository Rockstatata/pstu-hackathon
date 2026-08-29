# Group settlement preserves per-payer consent

A Settlement Plan may optimize obligations across many Users, but it never authorizes their Accounts
collectively. Each payer approves only their own current outgoing instructions, which execute as one
atomic Transfer through the existing engine; other payers settle independently.

## Considered Options

Executing an entire multi-payer plan atomically would be technically attractive but would debit
Accounts whose owners had not authenticated the action. Sequentially executing every payment after
one member clicks “settle all” has the same consent flaw and can also leave a partially completed plan.

## Consequences

Plans carry a deterministic version and are recomputed under an Expense Group lock before payment.
If Expenses or another settlement changed the plan, the payer must review the new instructions.
Completed Group Settlements are immutable and feed back into Net Positions, while every movement of
digital money still goes through the normal Transfer engine.
