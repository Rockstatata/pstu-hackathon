# Money Movement

A closed money ecosystem. Users hold simulated BDT balances and move money between one another.
Nothing enters or leaves the system except through issuance at registration.

## Language

### Parties and holdings

**User**:
A person with credentials who can authenticate and act in the system.
_Avoid_: Customer, Member

**Account**:
The holding of money belonging to exactly one User. Ledger entries reference Accounts, never Users.
_Avoid_: Wallet, Balance

**Issuance Account**:
The single system-owned Account that money is issued from. Every ৳100,000 granted at registration
is debited from it, so the system's total always sums to zero.
_Avoid_: Treasury, Bank, God account

### Money

**Poisha**:
The unit all amounts are counted in. One taka is 100 poisha. Taka exist only in what a human reads.
_Avoid_: Cents, Minor units

**Balance**:
The amount of money an Account currently holds. Authoritative, and always equal to the sum of that
Account's Journal Entries.

### The ledger

**Journal Entry**:
One immutable half of a money movement — an amount credited to or debited from a single Account.
Entries are never edited or deleted.
_Avoid_: Record, Log entry, Line item

**Ledger**:
The complete set of Journal Entries. The system's financial truth.

**Integrity Check**:
An assertion that the Ledger is internally consistent — money conserved, no Account negative, every
Balance matching its Entries. Answers "how do we know nothing was lost?"
_Avoid_: Audit, Health check

### Movements

**Transfer**:
A completed movement of money from one Account to others, recorded as Journal Entries summing to zero.
A Transfer either happened entirely or not at all; there is no partial Transfer.
_Avoid_: Transaction, Payment, Send

**Group Transfer**:
A single Transfer moving money from one Account to several recipients at once. Atomic across all
recipients — one failing recipient means none of them receive money.
_Avoid_: Batch, Split, Bulk send

**Reversal**:
A new Transfer that moves money back along the path of an earlier one. The original Transfer remains
in the Ledger untouched — financial history is compensated, never rewritten.
_Avoid_: Refund, Undo, Cancellation, Rollback

**Money Request**:
One User asking another to send them an amount. Carries a reason and expires if unanswered.
A Request never moves money by itself; paying one creates a Transfer.
_Avoid_: Invoice, Bill, Charge, Collection

### Safeguards

**Recipient Verification**:
Showing the sender the recipient's name and masked phone number for confirmation before a Transfer
is committed. Guards against sending the right amount to the wrong person.
_Avoid_: Confirmation, Preview

**Transfer Policy**:
The rules a proposed Transfer is tested against before it is allowed — amount bounds and daily totals.
_Avoid_: Validation, Rules engine

**Step-Up**:
An additional identity challenge demanded of a sender when a proposed Transfer looks risky.
_Avoid_: 2FA, Re-auth, Verification

**Receipt**:
The durable, shareable record of a Transfer as presented to a User, identified by its Transfer ID.
