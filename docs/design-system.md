# Design System — Chorui

The visual source of truth. Screens and components are specified in `docs/frontend-screens.md`;
this file specifies what they are made of. Domain words come from `CONTEXT.md` — the UI never
invents a synonym for a term defined there.

Every colour value below has been measured against its actual background. Where a value from the
locked palette failed the WCAG AA baseline that `docs/frontend-screens.md` already commits to, the
correction is recorded in **Measured corrections** with the number that forced it. Do not "restore"
those values without re-measuring.

---

## Identity

**Chorui** (চড়ুই — sparrow). Small, quick, ordinary, everywhere. The name is the promise: moving
money should feel as unremarkable as a bird crossing a yard.

Wordmark set in Inter SemiBold, sentence case, never all-caps. Logomark is a single-stroke sparrow
glyph in `--primary`; at 16px and below it degrades to the mark alone, never to a letterform.

The interface is a teller, not a salesperson. It states what will happen, does it, and shows the
receipt. It never congratulates the user for spending money, never uses exclamation marks outside
the one welcome moment on A3, and never implies urgency it cannot justify.

---

## Tokens

Declare on `:root`, redeclare under `.dark`. Nothing in the app hard-codes a hex value.

```css
:root {
  /* surfaces */
  --bg:               #F8F7FC;
  --bg-sidebar:       #F1EEFA;
  --surface:          #FFFFFF;
  --surface-subtle:   #F1EEFA;
  --surface-elevated: #FFFFFF;   /* light elevates with shadow, not lightness */

  /* brand */
  --primary:          #6D28D9;   /* button fills; white label = 7.10 */
  --primary-hover:    #5B21B6;
  --primary-fg:       #FFFFFF;
  --primary-text:     #6D28D9;   /* purple as text/links = 7.10 */
  --accent:           #8B5CF6;   /* icons, active states, borders — never small text */
  --purple-soft:      #EDE9FE;
  --purple-border:    #DDD6FE;

  /* text */
  --text:             #181221;   /* 18.30 */
  --text-secondary:   #6B6475;   /* 5.67 */
  --text-muted:       #938BA3;   /* 3.25 — large or non-essential text only */

  /* lines */
  --divider:          #E5E0EF;   /* 1.29 — decorative separators only */
  --border-control:   #938BA3;   /* 3.25 — inputs, checkboxes, anything operable */
  --focus:            #6D28D9;

  /* state */
  --success:          #16A34A;  --success-text: #15803D;  --success-surface: #DCFCE7;
  --warning:          #D97706;  --warning-text: #B45309;  --warning-surface: #FEF3C7;
  --danger:           #DC2626;  --danger-text:  #B91C1C;  --danger-surface:  #FEE2E2;
  --neutral-surface:  #F1EEFA;

  /* the one gradient */
  --gradient-text-safe: linear-gradient(135deg, #5B21B6 0%, #7C3AED 100%);
  --gradient-glow:      #8B5CF6;  /* decorative third stop; no text may sit on it */
}

.dark {
  --bg:               #0D0A1A;
  --bg-sidebar:       #110D20;
  --surface:          #181329;
  --surface-subtle:   #110D20;
  --surface-elevated: #211A35;   /* dark elevates with lightness, not shadow */

  --primary:          #7C3AED;   /* white label = 5.70; see corrections */
  --primary-hover:    #8B5CF6;
  --primary-fg:       #FFFFFF;
  --primary-text:     #C084FC;   /* 6.83 */
  --accent:           #8B5CF6;
  --purple-soft:      #2E2150;
  --purple-border:    #3B2B5C;

  --text:             #F5F3FF;   /* 16.45 */
  --text-secondary:   #A8A0BA;   /* 7.22 */
  --text-muted:       #756D87;   /* 3.69 — large or non-essential text only */

  --divider:          #2A2142;
  --border-control:   #756D87;
  --focus:            #C084FC;

  --success:          #22C55E;  --success-text: #4ADE80;  --success-surface: #14331F;
  --warning:          #F59E0B;  --warning-text: #FBBF24;  --warning-surface: #3A2A0C;
  --danger:           #EF4444;  --danger-text:  #F87171;  --danger-surface:  #3A1717;
  --neutral-surface:  #211A35;

  --gradient-text-safe: linear-gradient(135deg, #4C1D95 0%, #7C3AED 100%);
  --gradient-glow:      #A855F7;
}
```

Geometry and motion:

```css
:root {
  --r-sm: 8px;  --r-md: 12px;  --r-lg: 16px;  --r-xl: 20px;
  --shadow-card:  0 1px 2px rgba(24,18,33,.04), 0 8px 24px -12px rgba(91,33,182,.18);
  --shadow-sheet: 0 -8px 40px -12px rgba(24,18,33,.25);
  --ease: cubic-bezier(.2,.8,.2,1);
  --t-state: 150ms;  --t-sheet: 250ms;
}
```

Cards `--r-lg`. Buttons and inputs `--r-md`. Bottom sheets `--r-xl` on the top corners only. Chips
and badges fully rounded. In dark mode `--shadow-card` is `none` — depth comes from the surface step
`#0D0A1A → #181329 → #211A35`, because shadows are invisible on a near-black ground.

---

## Measured corrections

Four values from the locked palette do not survive the AA baseline. These are not preferences.

| Token | Locked value | Measured | Shipped as | Why |
|---|---|---|---|---|
| Success text | `#16A34A` | 3.30 on white | `#15803D` (5.02) | Transaction amounts are small green text. `#16A34A` survives as icon/fill/border, where 3:1 applies. |
| Warning text | `#D97706` | 2.99 on `#F8F7FC` | `#B45309` (5.02) | Fails even the 3:1 UI floor on the page background. |
| Border | `#E5E0EF` | 1.29 on white | `--border-control: #938BA3` (3.25) | `#E5E0EF` stays as `--divider`. An input border a user must find needs 3:1. |
| Dark primary | `#8B5CF6` | white label 4.23 | `#7C3AED` + white (5.70) | `#8B5CF6` stays as `--accent` for icons, active nav, and focus glow — every use that isn't small text. |

If you prefer the literal `#8B5CF6` button in dark, the only compliant pairing is a `#0D0A1A` label
(4.61). Pick one; do not ship white on `#8B5CF6`.

**Gradient text safety.** White is legible through `#7C3AED` (5.70) and no further — `#8B5CF6` is
4.23 and `#A855F7` is 3.96. So the text-bearing part of the gradient stops at `#7C3AED`, and the
light third stop appears only as the decorative glow in the far corner of the balance card, where
nothing is written.

---

## Typography

Inter via `next/font/google`, weights 400 / 500 / 600 / 700. Self-hosted by the loader, so no layout
shift and no third-party request on first paint.

**Every number that represents money sets `font-variant-numeric: tabular-nums`.** Amounts stack in
lists and must align on the decimal. This is a property of `AmountDisplay`, `AmountInput`,
`MetricTile`, and `IntegrityRow` — not a global.

| Role | Size / weight | Colour |
|---|---|---|
| Balance (B1) | 40/44, 700, tnum | `--primary-fg` on gradient |
| Amount, confirmation (C2) | 36/40, 700, tnum | `--text` |
| Metric number (I1) | 56/60, 700, tnum | `--text` |
| h1 | 24/32, 600 | `--text` |
| h2 / card title | 18/24, 600 | `--text` |
| Body | 15/22, 400 | `--text` |
| Amount in a list row | 15/22, 600, tnum | see the amount law |
| Label / caption | 13/18, 500 | `--text-secondary` |
| Legal / timestamp | 12/16, 400 | `--text-muted` |

Bengali numerals are never used for amounts. The taka sign always precedes with no space: `৳2,500.00`.

---

## The colour law

Purple is identity and action. Green, amber, and red are **state, and only state**. A semantic
colour never appears for decoration, and purple never signals an outcome.

| Colour | Means | Appears on |
|---|---|---|
| Purple | brand, primary action, selection, focus | CTAs, active nav, links, focus rings, balance card |
| Green | succeeded, healthy, money in | Completed / Paid badges, incoming amounts, I1 passing assertions |
| Amber | needs a decision, pending, degraded | Pending / Scheduled badges, step-up prompts, offline banner, I1 DEGRADED |
| Red | failed, blocked, dangerous | Failed / Declined badges, policy errors, I1 failing assertions, destructive confirms |

**Amendment to `docs/frontend-screens.md`.** That file describes `AmountDisplay` as "in green / out
red". Outgoing money is not a failure, and red is reserved. The shipped law:

- **Incoming** — `--success-text`, leading `+`, `ArrowDownLeft`
- **Outgoing** — `--text`, leading `−`, `ArrowUpRight`
- **Reversal** — `--text-secondary`, `RotateCcw`
- **Failed** — `--danger-text`, struck through, `AlertTriangle`

Sign, icon, and colour all carry the direction, so the row survives greyscale and colour blindness.
This satisfies the existing rule that colour is never the only signal.

### StatusBadge

Text on tinted surface, both themes measured at or above 4.5. The chip's fill is nearly invisible
against the page by design (1.03–1.15) — a badge is read from its text and icon, never its edge.

| Status | Light text / surface | Dark text / surface |
|---|---|---|
| Completed, Paid | `#15803D` / `#DCFCE7` (4.57) | `#4ADE80` / `#14331F` (7.91) |
| Pending, Scheduled | `#B45309` / `#FEF3C7` (4.51) | `#FBBF24` / `#3A2A0C` (8.30) |
| Failed, Declined | `#B91C1C` / `#FEE2E2` (5.30) | `#F87171` / `#3A1717` (5.77) |
| Reversed | `#6D28D9` / `#EDE9FE` (5.98) | `#C084FC` / `#2E2150` (5.48) |
| Expired, Cancelled | `#6B6475` / `#F1EEFA` (4.95) | `#A8A0BA` / `#211A35` (6.65) |

Neutral chips use `#F1EEFA`, never `#E5E0EF` — the latter measures 4.38 and fails.

---

## Component → token map

**BalanceCard** — the only gradient surface in the app. `--gradient-text-safe`, white text, glow
blob in `--gradient-glow` in the far corner with nothing written over it. Eye/EyeOff toggle at 44px.
Offline: gradient drops to 60% opacity and a `--text-muted` "last updated" line appears.

**AmountInput** — `--surface`, `--border-control` at rest, `--primary` 2px on focus, `--danger-text`
border and message when over balance or policy. `inputMode="numeric"`.

**PinInput** — five boxes, `--border-control`, a filled box takes a `--primary` border. Error shakes
and turns `--danger`; under reduced motion the border changes without the shake.

**RecipientCard** — `--surface-subtle` ground, avatar in `--purple-soft` with `--primary-text`
initials. Full name at body weight 600, `MaskedPhone` in `--text-secondary`. Never `--text-muted`
here: on C2 the masked phone is the safety-critical string and has to clear 4.5.

**ConfirmationSheet (C2)** — `--surface`, `--r-xl` top corners, `--shadow-sheet`. Confirm is
`--primary` filled; Cancel is a plain `--text-secondary` text button of equal height. Confirm is
deliberately not the easy default — same size as Cancel, never larger, and it never takes autofocus.

**StepUpDialog** — amber. `--warning-surface` header band, `--warning-text` reason line stating why
in a sentence. Amber because a step-up is a decision required, not a failure.

**PolicyError** — `--danger-surface` / `--danger-text`, `AlertTriangle`, one sentence, no code.

**OfflineBanner** — amber, pinned below the header, `WifiOff`. Send actions render disabled in
`--text-muted` on `--surface-subtle`, with the reason available to screen readers.

**Nav** — `--bg-sidebar`. Active item takes a `--purple-soft` fill, `--primary-text` label and icon,
and a 3px `--primary` rule (left at `lg`, top on the mobile tab bar). Inactive `--text-secondary`.

**I1 Integrity Dashboard** — always dark, whatever the app theme; it is a projector surface. `--bg`
ground, `MetricTile` on `--surface`, numbers at 56px tnum. `IntegrityRow` puts the assertion name in
`--text-secondary`, the value in `--text`, and a `Check` in `--success` or an `X` in `--danger`.
`VerdictBanner`: HEALTHY is `--success-surface` with `--success-text`, DEGRADED is `--danger-surface`
with `--danger-text`, both full-bleed with the word at 40px. `ReplicaStatus` dots are `--success`
healthy, `--danger` down, `--text-muted` unknown — each dot paired with its instance ID in text, so
the state is never colour alone.

---

## Theming mechanics

Class strategy on `<html>`, not media-query-only, because an explicit toggle has to be able to
override the OS.

- Default is **light**. Resolved before paint by an inline script reading `localStorage.theme`, then
  `prefers-color-scheme` — no flash, no hydration mismatch.
- I1 forces `.dark` on its own container and leaves the global preference alone.
- `<meta name="theme-color">` follows the resolved theme so the mobile browser chrome matches.
- Both themes ship from day one. Retrofitting dark later is the expensive version; declaring the
  tokens twice at Phase 0 is nearly free. This is why the PRD's P2 "dark mode" cut item no longer
  applies — there is no separable dark-mode work item left to cut.

## Accessibility

The baseline in `docs/frontend-screens.md` stands unchanged. What this file adds:

- Focus ring is 2px `--focus` at 2px offset. `--divider` is never a focus indicator; it measures 1.29.
- Any operable border uses `--border-control`. Any decorative line uses `--divider`.
- `--text-muted` is barred from amounts, from the masked phone on C2, from error text, and from I1.
- Transitions collapse to 0ms under `prefers-reduced-motion`, except opacity — a state change still
  has to be perceivable.
