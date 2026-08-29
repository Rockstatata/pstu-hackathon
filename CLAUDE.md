# pstu-hackathon — Money Movement Application

Closed-ecosystem money-movement app for the PSTU IT Carnival 2026 Hackathon (29 Aug 2026, 09:00–15:00).
Users hold fake BDT balances (BDT 100,000 granted on registration) and send / request money between accounts.

The judged property is **trustworthiness under adversity**, not feature count: correctness under
concurrency, safe behaviour on duplicate requests and crashes, and engineering decisions the team can
explain and defend.

Source docs — read before proposing architecture:

- `docs/problem statement.pdf` — the official challenge brief
- `docs/mfs-deep-research.md` — research on bKash / Nagad / M-PESA / Mojaloop / Juspay and the
  architecture it recommends for this build
- `docs/solution-prd` — the product requirements doc (may still be empty)

Non-negotiable architectural rule from the research: **the UI submits intentions; the backend
determines financial truth.** Authoritative balance logic never lives in React state, localStorage,
a service worker cache, Redis, or API process memory.

---

## Response defaults

Apply to every reply unless overridden in the prompt.

- Answer directly. No preamble, filler, affirmations, or trailing summary clauses.
- Plain prose or tight lists. No decorative headers for short answers.
- Do not use extended thinking or web search unless the prompt is explicitly complex or time-sensitive.
- If a task is simple (formatting, grammar, a short translation), note **once** that Haiku may suffice.
- At 15+ messages, offer **once** to summarize key context for a fresh chat.
- If a correction is requested, note **once** that editing the last message saves tokens.
- **Always state, up front in the response or plan, which model at which effort level is sufficient for
  the task** — judge complexity and scale yourself, and flag it as a check-before-proceeding note.

## Engineering rules

1. **Never create or recreate Python virtual environments.** `backend/venv` and `ai_service/venv` are
   user-managed. Activate them; never rebuild, delete, or `python -m venv` over them.
2. **Plan before coding.** Write the plan as a todo list in `tasks/todo.md`, get it verified, then work
   through it marking items done. Add a review section summarizing the changes when finished.
3. **Minimal blast radius.** Every change touches as little code as possible. No sweeping refactor
   bundled into a fix.
4. **Root-cause fixes only.** No temporary patches, no workarounds, no silencing symptoms.
5. **No emojis in UI.** Vector icons only (`lucide-react`).

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

---

## Design Context

The product is **Chorui** (চড়ুই — sparrow). Token values, measured contrast, and the
component-to-token map live in `docs/design-system.md`; screens and components in
`docs/frontend-screens.md`. Never hard-code a colour — every value is a token declared in both themes.

### Users

Bangladeshi mobile-money users, on a phone, one-handed, often on a poor connection — and, for the
next six hours, four judges watching a projector. Both audiences want the same thing: proof that the
money went where it was told to go. The job is not "transfer funds", it is **send this exact amount
to this exact person and be sure it happened**. Design for a user who is slightly anxious and in a
hurry, because that is the person who sends ৳25,000 to a mistyped number.

### Brand Personality

**Exact. Unhurried. Accountable.** The interface is a teller, not a salesperson: it states what will
happen, does it, and hands over a receipt. It never celebrates spending, never manufactures urgency,
and never hides a number it knows. Confidence is the target emotion — the calm kind that comes from
being told the truth, not the excited kind.

### Aesthetic Direction

Premium and technically sophisticated through restraint. Purple identity, flat surfaces, generous
spacing, one gradient in the entire app (the balance card). Reference mood is the supplied purple
fintech concept — colour only, not its layout. Anti-references: crypto-dashboard neon, gamified
wallet confetti, and enterprise-grey banking. Both themes ship from Phase 0; light is the default,
and I1 ships both, with its own toggle — it is read on a projector and on a laptop.

### Design Principles

1. **Purple acts, semantics report.** Purple is brand and action; green, amber, and red mean
   succeeded, needs-a-decision, and failed, and nothing else. Purple never signals an outcome, and a
   semantic colour never appears as decoration. Outgoing money is neutral, not red — it is not a failure.
2. **Measured, not eyeballed.** Every pairing meets WCAG AA against its real background. Four values
   in the locked palette failed and were corrected; the numbers are in `docs/design-system.md`.
   Re-measure before changing one.
3. **The amount is the largest thing on screen.** Money outranks chrome everywhere it appears, in
   tabular figures, through `AmountDisplay` alone. No inline formatting, ever.
4. **Friction where it protects.** C2 stands between intent and money in every flow, Confirm is never
   the visually easy default, and Cancel is always the same size. Everything that does not protect
   money gets out of the way.
5. **State is never colour alone.** Every direction, status, and verdict carries an icon and a word
   as well as a hue — the app has to survive greyscale, colour blindness, and a bad projector.
