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
