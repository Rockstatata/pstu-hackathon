# Reversal is consent-based compensation, never mutation

Reversing a transfer creates a *new* compensating transfer in the opposite direction; the original
journal entries are never edited or deleted. The reversal requires the recipient's approval — it is
raised as a money request linked to the original transfer.

Unilateral reversal was rejected because it is a theft primitive: it lets one user pull money out of
another's account without their authority, and it can drive the recipient's balance negative if they
have already spent the funds, breaking the no-negative-balance invariant the integrity check asserts.
Consent-based reversal also costs less to build, because it reuses the money request flow.

## Consequences

A reversal cannot itself be reversed, and individual legs of a group transfer cannot be reversed —
both would reintroduce the partial-state semantics ADR-0002 rejects.
