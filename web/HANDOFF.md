# web/ — handoff

**Caution: at least three agent sessions have written to this directory today, concurrently.**
Files changed underneath me while I was writing the previous version of this document, which is why
most of it was wrong within minutes. Verify before trusting any claim here, including mine.
Every statement below was checked against disk at the time of writing and is timestamped by that fact,
not by a promise.

## Build state — RED

`npm run build` fails. One TypeScript error, and it is the only thing standing between you and a
green build:

```
src/app/(app)/send/page.tsx(70,23): error TS2552: Cannot find name 'setRecipientError'.
```

Line 70 calls a setter that does not exist. Recipient lookup errors live on the `lookup` state
object (`lookup.error`), set via `setLookup`, not in a separate `recipientError` state. The likely
intended fix is to route that message through `setFormError`, matching the line directly below it.

**I did not fix it.** I was told to stop, and another session may be mid-edit in that exact file.
It is a one-line change; apply it first, then re-run the build before writing anything new.

Everything else compiles: Turbopack reports "Compiled successfully in 3.1s" and fails only at the
type-check step. `npx eslint src` is clean as of this writing (an earlier report of 5 errors /
2 warnings has already been fixed by someone).

## Read these first, in this order

1. `docs/design-system.md` — tokens, measured contrast, colour law, component→token map.
   **Every hex in the app is declared once, in `src/app/globals.css`. Nothing else hard-codes one.**
2. `docs/frontend-screens.md` — screens, states, responsive rules, cut-line awareness.
3. `CLAUDE.md` → Design Context — the five principles.

## The one genuinely open item

**`docs/api-contract.md` does not exist**, but `src/lib/types.ts` and `src/lib/api.ts` both cite it.
The types are sound — derived directly from `docs/solution-prd` §26–27 — but the reference dangles
and no one owns writing it. Two separate sessions reached this independently. It is the most likely
cause of a painful frontend/backend integration when the transfer engine lands.

## What exists

**Token layer — complete and measured.** `src/app/globals.css`: both themes as CSS variables, mapped
into Tailwind v4 via `@theme inline`, with `@custom-variant dark` for class-based theming. Utilities
`.tnum`, `.card`, `.balance-gradient`, `.safe-bottom`, `.sheet-enter`; `sheet-enter` and `shake`
keyframes; reduced-motion block.

Four values in the supplied palette failed WCAG AA and are corrected in the token layer. The numbers
are in `docs/design-system.md` → Measured corrections. **Do not restore the originals without
re-measuring** — success green is 3.30:1 on white and transaction amounts are small green text.

**Routes** — `/`, `/login`, `/register`, `/send`, `/send/receipt/[reference]`, `/history`,
`/history/[reference]`, `/integrity`.

**`src/lib/`** — `money.ts` (the only money formatter in the codebase), `types.ts`, `api.ts` (typed
client, `ApiError.sentence` maps each domain code to a plain sentence, `Idempotency-Key`, JWT in
`Authorization: Bearer` per ADR-0007), `nav.ts`, `fixtures.ts`, `cn.ts`.

**`nav.ts` is load-bearing.** Tabs and quick actions render from that array, each entry carrying a
`shipped` flag. Never hard-code a nav item into a layout, and never ship a tab pointing at an unbuilt
feature.

**Components** — `ui/`: Button, Field, StatusBadge, EmptyState, Skeleton, PhoneInput, ThemeToggle,
OfflineBanner, FixtureNotice. `money/`: AmountDisplay, AmountInput, BalanceCard, RecipientCard,
PinInput. `tx/`: TransactionList, TransactionListItem, ReceiptCard. `send/`: ConfirmationSheet.
`auth/`: AuthFrame. `layout/`: AppShell.

I authored the token layer, `lib/` (except later edits), Button, Field, StatusBadge, AmountDisplay,
AmountInput, BalanceCard, RecipientCard. **Everything else was written by other sessions and I have
not reviewed it line by line.** It reads consistently with the tokens and correctly consumes
`shippedTabs()`.

## Fixtures — safeguard is in place

`src/lib/fixtures.ts` is off unless `NEXT_PUBLIC_USE_FIXTURES=1`. It holds an in-memory balance that
decrements on send, which is what `CLAUDE.md` forbids of production code; it exists only so the UI
could be reviewed before the backend landed. It is a stand-in, not a simulator.

`src/components/ui/FixtureNotice.tsx` renders a visible warning whenever the flag is on, and it gates
correctly (returns `null` when the flag is not `"1"`). I flagged this banner as missing in the
previous version of this document; that was wrong — another session had already built it.
**Still do not enable fixtures for the demo.**

## What does not exist

`MaskedPhone`, `RecipientChip`, `StepUpDialog`, `PolicyError`, Modal/BottomSheet, Tabs, Avatar,
Toast, and the dashboard set (`MetricTile`, `IntegrityRow`, `ReplicaStatus`, `VerdictBanner`) — check
`/integrity` to see what it currently uses instead. Screens below the cut line (Requests, Group,
Scheduled, Notifications) are untouched by design.

Full checklist: `tasks/todo.md` → "Frontend implementation — web/".

## Rules that are easy to break by accident

1. Every amount goes through `AmountDisplay`. No inline formatting anywhere, ever.
2. **Outgoing money is not red.** Red means failure. Out is `--text` with a `−` and `ArrowUpRight`;
   in is `--success-text` with a `+`. Sign, icon and colour all carry direction, so it survives greyscale.
3. C2 (Recipient Verification) is never skippable in any flow, and Confirm is never the visually easy
   default — same size as Cancel, never autofocused.
4. **No `aria-live` on the balance.** Phase 11 polls it every 10s; a live region there re-announces on
   every tick and makes the app unusable with a screen reader. Keep it on transfer results and errors.
5. Offline disables sending, never queues it (ADR-0004). Cached balance is display-only and must never
   be read back as input to a validation or policy decision.
6. Errors are sentences, never codes. Use `ApiError.sentence`.
7. The word is **Reverse**, never "Undo".
8. No emojis. `lucide-react` only.
9. A disabled control means "not allowed for this transfer" — never "we ran out of time". Hide unbuilt
   features via the `shipped` flag in `lib/nav.ts` rather than rendering them disabled.
