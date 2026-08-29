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

### Physical cash

**Smart Wallet**:
A physical cash container associated with one User. It reports observations about banknotes but does
not hold or create digital money.
_Avoid_: Account, Digital Wallet

**Expected Cash**:
The physical cash amount implied by the Smart Wallet's Cash Events. It is an inventory expectation,
not an Account Balance and not part of the digital Ledger.
_Avoid_: Balance, Available Balance

**Cash Event**:
An immutable observation that physical cash entered or left a Smart Wallet, or that a counted amount
was explicitly reconciled. Cash Events form the Cash Inventory Journal.
_Avoid_: Transfer, Journal Entry, Transaction

**Cash Count Reconciliation**:
An explicit Cash Event recording Expected Cash, Counted Cash, and their discrepancy. It changes the
current expectation without rewriting earlier Cash Events.
_Avoid_: Integrity Check, Silent adjustment

### Shared expenses

**Expense Group**:
A named set of Users who record shared Expenses and settle the resulting obligations with one another.
_Avoid_: Group Transfer, Chat group

**Expense**:
An immutable statement that one User paid an amount on behalf of members of an Expense Group.
_Avoid_: Transfer, Payment

**Expense Share**:
The portion of an Expense assigned to one member. All Shares of an Expense sum exactly to its amount.
_Avoid_: Journal Entry, Recipient

**Net Position**:
What one member should receive or pay after all Expense Shares and completed Group Settlements are
combined. Positive receives; negative pays.
_Avoid_: Account Balance, Debt balance

**Settlement Plan**:
An explainable, non-financial proposal that converts all current Net Positions into practical
member-to-member payments. A plan never moves money by itself.
_Avoid_: Group Transfer, Transfer

**Group Settlement**:
One member's approved outgoing Transfer satisfying their current part of a Settlement Plan. Different
payers approve and complete their own Group Settlements independently.
_Avoid_: Settle All, Atomic multi-payer Transfer

### Future instructions

**Scheduled Transfer**:
A PIN-authorized instruction to attempt one Transfer at a future time. It is an intention, not money
and not a pending Journal Entry.
_Avoid_: Pending Transfer, Reserved money

**Execution Time**:
The earliest instant at which a Scheduled Transfer may be claimed. Balance, recipient, policy, and
risk are evaluated again at execution.
_Avoid_: Guaranteed delivery time

### Financial understanding

**Financial Outlook**:
A read-only explanation of a User's Account activity based on disclosed, deterministic calculations.
It describes observed patterns without rating the User or deciding what they should do.
_Avoid_: Financial Health Score, AI Assistant, Advice

**Goal Projection**:
A hypothetical path from a starting amount to a chosen target under assumptions the User controls.
It neither reserves money nor creates a Scheduled Transfer.
_Avoid_: Savings Account, Guaranteed Forecast, Plan

**Typical Money Out**:
The average amount that left an Account across eligible, complete calendar months. It is a historical
baseline, not a spending limit.
_Avoid_: Budget, Recommended Spending
