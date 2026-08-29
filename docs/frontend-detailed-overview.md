# Frontend Detailed Overview

The frontend is the user-facing layer of the Chorui money-movement product. It is not the authority on money; it is the interface that collects intent, loads account state from the backend, asks for confirmation, and renders the final result in a calm, trustworthy way.

The design intent is simple: the app should feel dependable, precise, and low-drama. The user is often moving money quickly and wants confidence that the transaction reached the correct recipient and the correct amount.

---

## 1. What the frontend is responsible for

The frontend does not maintain ledger state. It does not decide whether a transfer is valid. It does not calculate balances for final financial decisions. Instead, it does four main things:

1. authenticates the user
2. loads backend truth
3. collects user intent and sends it to the backend
4. renders backend responses clearly and safely

That is why the frontend lives in Next.js and keeps the API boundary isolated in `web/src/lib/api.ts`.

This is one of the most important design decisions in the repo: all money decisions are anchored in the backend, and the frontend is only a human-facing consumer of approval and results.

---

## 2. Frontend stack

The frontend is currently built with:

- Next.js
- TypeScript
- Tailwind CSS
- Lucide React icons
- a strong routing and app shell structure under `src/app/`

The app is organized as a mobile-first, PWA-like fintech interface. It is designed around planned flows like wallet, send money, history, requests, notifications, and integrity monitoring.

### Main frontend folders

- `web/src/app/` — route pages and app layout
- `web/src/components/` — reusable UI blocks
- `web/src/lib/` — API client, money formatting, types, fixtures
- `web/src/public/` — static public assets
- `web/src/app/(app)/` — authenticated app section
- `web/src/app/(auth)/` — sign-in and registration views

---

## 3. Core frontend principle: money is displayed, never invented

One of the strongest frontend rules in this project is that all monetary amounts are integer poisha values, never floating-point taka values.

The frontend handles this by keeping amounts in their smallest unit and only converting them for display.

Examples:

- backend stores money as integer poisha
- UI receives `balanceMinor` or `amountMinor`
- frontend calls formatting helpers to display `৳2,500.00`
- the browser never tries to do financial calculations as a trusted source

This rule is enforced by helper modules such as:

- `web/src/lib/money.ts`
- `web/src/components/money/AmountDisplay.tsx`

The `AmountDisplay` component is treated as the single canonical renderer for money values across the app, which makes the UI consistent and prevents accidental formatting drift.

---

## 4. The app shell and app structure

The root layout in `web/src/app/layout.tsx` sets the overall behavior of the app:

- theme initialization before first paint
- dark mode preference behavior using localStorage
- `font` configuration via Inter
- `<html>` and `<body>` setup
- a global app wrapper for the page content

This is a frontend pattern meant to avoid flash-of-incorrect-theme issues and maintain a stable visual identity across the app.

The app shell is intentionally quiet and premium-looking rather than flashy. The product brand is described as calm, controlled, and accountable, which is reflected in the styling and UI tone.

---

## 5. Theme and design system

The visual identity is inspired by a fintech design system rather than a generic consumer app.

Important frontend rules from the repo:

- purple acts as brand and action color
- green, amber, and red carry semantic meaning, not decoration
- outgoing money is neutral, not red
- the amount is the biggest thing on screen
- friction is placed where it protects money
- status must be readable without color dependence

This means the frontend is designed to be more than pretty. It is designed to communicate truth, not hype.

The design system plans are in:

- `docs/design-system.md`
- `docs/frontend-screens.md`

The UI is meant to feel trustworthy under a projector and under stress. That is why the design emphasizes clarity, spacing, contrast, and data hierarchy.

---

## 6. The wallet page as a representative frontend screen

The wallet page at `web/src/app/(app)/wallet/page.tsx` is a good example of the frontend’s role.

What it does:

- loads the signed-in user
- loads the signed-in account information
- displays the current balance
- shows protection messaging and account details
- includes a smart-account card design
- handles error states
- supports copying the account ID when available

The screen behaves like this:

1. It calls `api.me()` and `api.account()` in parallel.
2. If both calls succeed, it stores the values in state.
3. If one fails, it surfaces a friendly error message.
4. It renders a skeleton loader until data arrives.
5. It displays a styled account card with the current balance.

That is a perfect example of the frontend pattern: fetch backend truth, render it, preserve trust, and fail gracefully.

---

## 7. Money rendering pattern

The frontend strongly standardizes money presentation through the `AmountDisplay` component.

This component receives:

- `minor` amount in poisha
- `kind` such as `IN`, `OUT`, `REVERSAL`, `FAILED`, or `PLAIN`
- `size` like `sm`, `md`, `lg`, `xl`
- an optional icon display
- styling class names

It renders money with the proper sign and semantics. For example:

- incoming funds are positive and green
- outgoing funds are negative and neutral in tone
- failed transactions can be struck through
- the icon and the sign communicate the meaning together

This is a very intentional design choice because the app must survive grayscale rendering and accessibility constraints.

---

## 8. The API layer is the frontend’s boundary

The API client in `web/src/lib/api.ts` is the core of the frontend’s backend integration.

It centralizes the following:

- base URL configuration
- token storage
- request building
- JSON parsing
- error normalization
- semantic mapping from backend error codes to user-friendly messages

This file is important because it prevents the rest of the app from directly dealing with raw fetch logic.

### Key behaviors

- reads token from localStorage under `chorui.token`
- attaches `Authorization: Bearer <token>` to requests
- attaches `Idempotency-Key` for write operations
- converts server errors into a consistent `ApiError` object
- exposes a readable `sentence` property that is safe for the UI to show

This is crucial for a money app. The UI must never expose raw backend internals or confusing stack traces to the user.

---

## 9. Token handling and authentication flow

The frontend stores the JWT in browser localStorage and uses it across requests.

The design is intentionally simple:

- login/register returns a JWT
- the frontend saves it
- future API calls include the JWT in the Authorization header
- if the backend returns `401`, the frontend clears the token and the user is prompted to sign in again

This is the real client-side identity pattern used here.

The frontend never treats the token as the authority on account balances. It is only an identity credential used to access backend data.

---

## 10. Error handling model

The frontend is careful about not showing raw technical errors to users.

The `ApiError` class maps backend codes to frontend-friendly sentences. For example:

- `INSUFFICIENT_FUNDS` -> “You do not have enough balance for this transfer.”
- `UNAUTHENTICATED` -> “Your session has expired. Sign in again.”
- `NETWORK` -> “We could not reach the server. Nothing was sent.”
- `FINANCIAL_CORE_UNAVAILABLE` -> “Transfers are briefly unavailable. No money has moved.”

This is a very strong UX pattern. It ensures the app communicates calm, safe language rather than exposing low-level errors. This matters especially in a financial product where uncertainty is common but user trust must remain high.

---

## 11. Idempotency on the frontend

The frontend generates one idempotency key per user-confirmed money action and keeps it stable across retries.

The `newIdempotencyKey()` helper creates a UUID and passes it to the backend through the `Idempotency-Key` header.

This matters because the backend is designed to protect against duplicate submits. The frontend needs to cooperate by keeping the same key until the action is definitively resolved.

The frontend’s job is not to “retry aggressively” when a write is ambiguous. Instead, it follows safe rules:

- keep the idempotency key same across the attempt
- do not assume a network failure means the money definitely failed
- when uncertain, inspect transfer history or the request detail before retrying

This is part of the product’s trustworthiness model.

---

## 12. Data typing and frontend contracts

The app has strongly typed TypeScript models in `web/src/lib/types.ts`.

These models define:

- `AuthUser`
- `AccountSummary`
- `RecipientPreview`
- `Transfer`
- `TransferListResponse`
- `MoneyRequest`
- `CreateTransferRequest`
- `Notification`
- `IntegrityReport`
- `SystemInfo`

This is important because a money app needs clear contracts around fields like:

- `balanceMinor`
- `amountMinor`
- `counterpartyMaskedPhone`
- `status`
- `direction`
- `reference`

The naming convention makes intent clear. The money values are always called `Minor` to make the poisha rule evident in the code, instead of pretending all amounts are normal decimal taka numbers.

---

## 13. Frontend state model

The current frontend uses React state in a straightforward way:

- `useState` for loading values, error messages, and UI flags
- `useEffect` for fetching initial data after mount
- small local state for copy actions, toggles, and view-specific flags

This keeps the frontend simple and easy to reason about. It does not try to maintain a sprawling Redux store or complex client-side state machine for money movement because the backend is the real source of truth.

The UI is intentionally narrow and explicit rather than over-engineered. The app is designed around a few important flows rather than a broad feature set.

---

## 14. Frontend routes and screens

The app is structured around a set of expected user journeys.

### Auth flows

- register
- login
- welcome / funded confirmation

### Home

- wallet dashboard
- balance card
- recent activity
- quick actions

### Money movement

- compose send form
- confirm recipient
- step-up PIN challenge
- final receipt

### History

- transaction history
- transaction detail
- reverse and related status display

### Requests

- create request
- incoming/outgoing request views
- pay or decline flows

### System health

- integrity dashboard
- replica health and financial checks

This is not a general app shell. It is explicitly a financing app with a strict flow model and narrow responsibilities.

---

## 15. Component philosophy

The project is intentionally component-driven, but it avoids overbuilding. The frontend tries to keep the key visual and behavior patterns reusable:

- `Button`
- `Input`
- `Skeleton`
- `FixtureNotice`
- `AmountDisplay`
- account card patterns
- list item patterns
- status badges

The idea is that a few reusable building blocks can support many flows while keeping the product coherent and consistent.

This is especially important in a demo app, where the UI needs to look polished without becoming overly generic or bloated.

---

## 16. Fixture mode and UI-only development

The frontend has a controlled fixture mode for visual work before the backend is available.

This is configured in `web/src/lib/fixtures.ts` and toggled with an environment variable:

- `NEXT_PUBLIC_USE_FIXTURES=1`

This is useful for design iteration and UI debugging without a live backend. However, the repo explicitly warns: fixture mode is not authoritative financial state.

This is a very important distinction. The frontend can render believable data for product design, but it must never be mistaken for real ledger truth.

---

## 17. Frontend safety rules

Several safety rules are written directly into the project’s UX contract:

- no hidden or silent retry on money writes
- no client-side authoritative balance calculations
- no floating-point money math
- no display of raw response codes as primary user messaging
- no fake financial success if the backend fails
- money values are read from the backend and not invented in the browser

This makes the frontend a careful companion to the backend rather than an independent financial engine.

---

## 18. What the frontend does well

The frontend is good at:

- showing a trustworthy balance card
- capturing user intent clearly
- reducing wrong-recipient risk with recipient verification screens
- rendering money values consistently and clearly
- exposing backend state cleanly to users
- keeping the product calm and low-friction under stress

The product is built around confidence and exactness, not excitement or aggressive sales language.

---

## 19. What the frontend does not do

The frontend does not:

- decide whether a transfer should succeed
- own ledger state
- create financial truth from browser data
- silently queue money movement for later
- use client-side state as the source of balances

Those things belong to the backend and database.

---

## 20. Final summary

The frontend is the polished, human-facing presentation layer of the money app. It is designed to look calm, precise, and dependable while staying truthful to the backend’s financial reality.

Its responsibilities are narrow and important:

- authenticate users
- fetch account and transaction state
- collect intentions and send them to the backend
- present results, receipts, errors, and account information clearly
- never act as the final authority on money

The design is intentionally built around the principle that a user should feel confident that the money went exactly where it was told to go. That confidence comes from a frontend that is simple, consistent, and tied to a reliable backend.
