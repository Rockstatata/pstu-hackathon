# Frontend Screens & Components

Next.js PWA. No emojis anywhere in the UI — `lucide-react` vector icons only.
All amounts are held as **poisha** (integers) and formatted to `৳2,500.00` only at render.

---

## Visual design

Specified in **`docs/design-system.md`** — tokens, colour law, typography, and the component → token
map. That file is the visual source of truth; this one specifies screens, states and layout. Where
the two disagree, `design-system.md` wins and this file gets amended.

Note in particular its amendment to the amount colours below: outgoing money is **not** red.

---

## Screen inventory

**19 numbered entries across 10 flows — 17 of them are routes.** A3 and C3 are overlays rendered
over B1 and C2 respectively, not routable screens. Build priority: **P0** (demo-critical), **P1**,
**P2** (cut first).

> **Cut-line awareness.** `tasks/todo.md` defines a cut line after Phase 6. Flows F, G and parts of
> C3/E2 fall below it. Any screen above the line must be complete and coherent *without* the
> below-line features — see the `— above the cut line` notes on B1, C3, E2 and I1. Do not ship a
> control that points at something that was cut.

### A. Authentication

**A1. Register** — P0
Fields: full name, phone number, 5-digit PIN, confirm PIN.
States: idle / validating / phone already registered / submitting / success.
On success the user is funded ৳100,000 — make this a welcome moment, not a silent redirect.

**A2. Login** — P0
Fields: phone number, 5-digit PIN.
States: idle / submitting / invalid credentials.

**A3. Welcome / Funded** — P1
One-time confirmation that ৳100,000 has been issued. Can be a modal over Home rather than a route.

### B. Home

**B1. Home / Dashboard** — P0
Default landing route. Contains:
- Balance card (large, primary) with hide/show toggle
- Quick actions row — **above the cut line this is `Send` alone**; Request, Group Send and Scheduled
  join it as their phases (7, 8, 12) land. Drive it from the same config array as the tab bar. One
  confident full-width Send reads better than four buttons where three are dead.
- Pending requests strip (only when count > 0) — the most urgent element on the page. Phase 7; absent
  entirely above the cut line, not rendered empty
- Recent transactions (last 5) with "See all"

States: loading skeleton / loaded / offline (balance dimmed, "Last updated 12:42") / empty history.

### C. Send Money

**C1. Send — Compose** — P0
Two steps in one screen: recipient (phone entry + recent-recipient shortcuts), then amount + optional note. Live balance shown; amount checked against balance and policy limits.
States: entering recipient / recipient not found / recipient found (name shown inline) / entering amount / exceeds balance / exceeds limit / ready.

**C2. Recipient Verification** — P0 — *the highest-value screen in the app*
A blocking confirmation sheet before any money moves. Amount large, recipient's **full name**, **masked phone** (`017•••••432`), note.
Actions: `Cancel` / `Confirm ৳2,500`.
This screen exists to stop the right amount reaching the wrong person. Do not make it skippable, and do not make Confirm the visually easy default.

**C3. Step-Up PIN** — P1 — *Phase 10, below the cut line*
If Phase 10 is cut, C2 confirms directly and **the "step-ups triggered" counter must come off I1**
rather than sit at a permanent zero on the judge-facing screen. See the note on I1.
Appears over C2 only when risk rules fire (amount ≥ ৳25,000, first-time recipient, or ≥5 transfers in 10 minutes). Must state *why*: "First time sending to this person."
States: entering / wrong PIN / attempts remaining / blocked.

**C4. Receipt** — P0
Check mark, amount, recipient, status, **Transaction ID**, timestamp.
Actions: Done, Copy ID.
States: success / failed (plain-language reason, never a raw error code).

### D. Group Send

**D1. Group Compose** — P1
Multi-recipient chip input, then either a per-person amount or a total split evenly. Running total and remaining balance.
Reuses C2 and C4 for confirmation and receipt.
States: adding recipients / one recipient invalid (**blocks the whole group** — say so explicitly) / total exceeds balance / ready.
The confirmation sheet must list **every** recipient and the total, not just a count.

### E. History

**E1. Transaction History** — P0
Reverse-chronological, grouped by date. Filters: All / Sent / Received / Reversed.
States: loading / loaded / empty / offline (cached, timestamped).

**E2. Transaction Detail** — P0
Full receipt plus counterparty, note, and the risk decision if a step-up fired.

**Above the cut line, E2 has no actions.** `Request Reversal` is Phase 9 and depends on Phase 7, so
in the demo build E2 is a pure detail view — and that is a complete, coherent screen, not a stub. Do
not render a disabled Reverse button as a placeholder for unbuilt work; a disabled control has to
mean "not allowed for *this* transfer", never "we ran out of time".

With Phase 9 shipped, the action appears: `Request Reversal` — 1:1 transfers only; disabled **with a
stated reason** on group legs and on reversals themselves (ADR-0005).
A reversed transfer links to its compensating transfer, and vice versa.

### F. Money Requests

**F1. Create Request** — P1
Fields: from whom (phone), amount, reason, expiry (fixed 24h, shown but not editable).

**F2. Requests Inbox** — P1
Tabs: **Incoming** (Pay / Decline) and **Outgoing** (Cancel).
Status badges: Pending / Paid / Declined / Expired / Cancelled.
States: loading / empty per tab / loaded.

**F3. Request Detail** — P1
Requester, amount, reason, time remaining.
`Pay` routes into C2 → C4 — paying a request is a normal transfer, not a special path.
Reversal requests render here too, badged as a reversal and linked to the original transfer.

### G. Scheduled Transfers

**G1. Scheduled List** — P2
Upcoming and past. Status: Scheduled / Executed / Failed / Cancelled.
A failed one must show why (e.g. insufficient balance at execution time).

**G2. Create Scheduled Transfer** — P2
Recipient, amount, date & time. Confirmation reuses C2 with an "on 30 Aug, 10:00" line.

### H. Notifications

**H1. Notifications** — P1
Bell with unread count in the header; panel or page listing money received, requests received, requests paid/declined/expired, reversal requests, scheduled executions.
States: empty / unread / read.

### I. System Integrity Dashboard

**I1. Integrity Dashboard** — P0 — *the judge-facing screen*
Two blocks, computed live on every load:
- **System health** — API replicas healthy (3/3), completed transfers, idempotent replays, rejected
  overspend attempts. **"Step-ups triggered" only if Phase 10 shipped** — every tile on this screen
  must be a number the demo can actually move, because a judge will ask us to move it. A tile that
  reads 0 all afternoon invites exactly the question we do not want.
- **Financial integrity** — negative accounts, unbalanced transactions, transfers missing journal entries, issued funds, sum of wallet balances, difference; each with a pass/fail indicator
- One overall verdict: **HEALTHY** / **DEGRADED**

Design for a projector: large numbers, high contrast, readable from the back of a room.

### J. Settings

**J1. Profile & Settings** — P2
Name, phone, logout. Keep it minimal.

---

## Component inventory

**Twelve of these are above the cut line.** Build only these before the line, in this order:
`Button`, `Input`, `AmountDisplay`, `AmountInput`, `PhoneInput`, `PinInput`, `BalanceCard`,
`TransactionListItem`, `ConfirmationSheet`, `StatusBadge`, `EmptyState`, `Skeleton`.

Everything else in this inventory belongs to a below-the-line phase. At 13:00, nobody should be
writing `ExpiryCountdown`. The full list is the finished shape of the app, not the build order.

### Money & identity
- **BalanceCard** — large amount, hide/show toggle, "last updated" line for offline
- **AmountInput** — poisha-backed, ৳ prefix, thousands separators, numeric keypad on mobile
- **AmountDisplay** — the single component for every amount rendered anywhere; sign and colour by direction
- **PhoneInput** — BD format + validation
- **PinInput** — 5 masked boxes, auto-advance, shake on error
- **RecipientCard** — initials avatar, full name, masked phone
- **RecipientChip** — removable, for group send
- **MaskedPhone** — `017•••••432`, used everywhere a phone appears

### Transactions
- **TransactionListItem** — direction icon, counterparty, amount (incoming green, outgoing neutral; see docs/design-system.md), status, time
- **TransactionList** — date-grouped with sticky date headers
- **StatusBadge** — Completed, Pending, Paid, Declined, Expired, Cancelled, Reversed, Failed
- **ReceiptCard** — the shareable receipt block, reused by C4 and E2
- **DirectionIcon** — `ArrowUpRight` sent / `ArrowDownLeft` received / `RotateCcw` reversal

### Requests
- **RequestCard** — requester, amount, reason, expiry countdown, Pay / Decline
- **ExpiryCountdown** — "expires in 18h"

### Confirmation & risk
- **ConfirmationSheet** — the C2 shell; takes amount, recipient(s), note, confirm label
- **StepUpDialog** — PIN challenge with a stated reason
- **PolicyError** — plain-language limit violations, never raw validation output

### Dashboard
- **MetricTile** — label, big number, optional delta
- **IntegrityRow** — assertion name, value, pass/fail indicator
- **ReplicaStatus** — 3/3 healthy, per-instance dots
- **VerdictBanner** — HEALTHY / DEGRADED

### System
- **NotificationBell** — icon + unread count
- **NotificationItem**
- **OfflineBanner** — "Reconnect to securely send money", pinned; disables send actions
- **EmptyState** — icon, headline, one action
- **Toast**
- **Skeleton** — list and card variants
- **Button**, **Input**, **Modal / BottomSheet**, **Tabs**, **Avatar**

### Icons (lucide-react)
`Send`, `HandCoins`, `Users`, `CalendarClock`, `ArrowUpRight`, `ArrowDownLeft`, `RotateCcw`, `ShieldCheck`, `Bell`, `WifiOff`, `Eye` / `EyeOff`, `Check`, `X`, `AlertTriangle`, `Copy`, `Activity`.

---

## Cross-cutting design rules

1. **Every amount renders through `AmountDisplay`.** One formatter, one source of truth, no inline `toFixed`.
2. **Confirmation is never skippable.** C2 stands between intent and money in every flow — send, group, request payment, scheduled, reversal.
3. **Offline disables sending, never queues it** (ADR-0004). Balance and history stay readable and
   timestamped. The cached copy is **display-only**: it is rendered with its "last updated" time and
   is never read back as an input to a balance check, a policy decision, or a form validation. Per
   `CLAUDE.md`, financial truth is the backend's; a cached number is a screenshot, not a balance.
4. **Errors are sentences.** "You can send up to ৳100,000 per transfer" — not `AMOUNT_LIMIT_EXCEEDED`.
5. **Nothing says "Undo".** The word is **Reverse**, and the original transfer stays visible in history next to its reversal.
6. **No emojis.** Vector icons only.

---

## Responsive

**Mobile-first everywhere except I1.** Design at 390px and scale up; `md:` / `lg:` prefixes are additive. Retrofitting desktop-first is a rewrite we cannot afford, so no component gets written desktop-only.

### Breakpoints (Tailwind defaults)

| Range | Target | Shell |
|---|---|---|
| base 320–639 | Phone — **primary design target** | Bottom tab bar |
| sm 640 | Large phone | Bottom tab bar |
| md 768 | Tablet | Bottom tab bar, wider cards |
| lg 1024 | Desktop | Left sidebar 240px, no bottom bar |
| xl 1280+ | Wide | Sidebar + content capped at 1120px, centred |

### Shell

- **Below `lg`** — bottom tab bar, 56px tall plus `env(safe-area-inset-bottom)`.
- **`lg` and up** — left sidebar; bottom bar disappears.
- **Send is not a tab.** It is the primary action on Home, so the main flow stays one tap from landing.

**The tab set depends on the cut line.** Requests is Phase 7, below it.

| Build | Tabs |
|---|---|
| Above the cut line (the demo) | Home · History · Integrity |
| With Phase 7 shipped | Home · History · Requests · More |

Render the tab set from a single config array, not four hard-coded `<Link>`s, so dropping Requests
is a one-line change at 14:00 rather than a layout edit. **Never ship a tab that routes to a cut
feature** — a dead tab is the most visible possible admission that something was unfinished.
Integrity is a tab in the demo build precisely because it is the screen we want judges to find.

### Sheets and modals

- Below `md`: full-height bottom sheet with a drag handle.
- `md` and up: centred modal, `max-w-md`.
- C2 (Recipient Verification) uses this pattern in every flow.

### Per-screen layout

- **B1 Home** — single column; at `lg`, balance + actions left, recent transactions right
- **C1 / C4 / F1 / G2** — single column, `max-w-md` centred on desktop
- **E1 History** — single column list throughout, `max-w-2xl` at `lg`
- **D1 Group** — chips wrap; recipient list scrolls independently of the total bar
- **I1 Integrity** — **desktop-first exception.** 4-column grid at `xl`, 2 at `md`, stacked cards at base. Sized for a projector, not a phone.

### Touch

- Minimum **44×44px** for every interactive element, including icon buttons and chip removals
- **Sticky bottom CTA on C1, D1, F1 and G2 only** — the compose screens, where the action is the
  point of the screen. It sits above the tab bar with safe-area padding. B1 does **not** get one:
  its actions live in the quick-actions row, and a sticky bar there would compete with them and
  bury the recent-transactions list.
- `inputMode="numeric"` on amount and PIN inputs
- No hover-only affordances — anything discoverable by hover must also be visible or tappable

## Accessibility (baseline)

- Semantic HTML; exactly one `h1` per screen
- Every input has a real `<label>`; error text linked via `aria-describedby`
- Visible focus ring on every focusable element — never `outline-none` without a replacement
- WCAG AA contrast: 4.5:1 body text, 3:1 large text and UI borders
- `aria-live="polite"` on **transfer results and policy errors**. **Not on the balance** — Phase 11
  polls every 10s, and a live region on a polled value re-announces on every tick, which makes the
  app unusable with a screen reader open. The balance announces only when its value actually
  changes, and only as a consequence of an action the user took.
- `prefers-reduced-motion` honoured on all transitions (one Tailwind variant)
- Colour is never the only signal — every amount pairs its colour with a sign (`+` / `−`) and a
  direction icon. See the amount law in `docs/design-system.md`, which supersedes "green / red"

### Test matrix

390×844 (iPhone 14) · 360×800 (Android) · 768 (tablet) · 1440 (desktop) · plus a real phone on the deployed URL.

