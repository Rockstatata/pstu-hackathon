# Physical cash uses a separate inventory journal

Smart Wallet observations are recorded in an append-only Cash Inventory Journal, not as Journal
Entries in the conserved digital Ledger. A banknote entering or leaving a physical wallet has no
digital Account counterparty, so forcing it through the Transfer engine would either break the
zero-sum and Issuance Account invariants or falsely manufacture digital value.

## Consequences

The digital Ledger remains the sole financial truth for Account Balances and Transfers. Expected
Cash is a separate cached projection checked against Cash Events; Cash Count Reconciliation appends
an explanatory event rather than editing history. Both journals share PostgreSQL transactionality,
idempotency, ownership checks, audit events, and a unified user interface.
