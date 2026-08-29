# Chorui web

The Next.js PWA frontend for Chorui. It renders financial values from integer poisha only and talks to the API through `src/lib/api.ts`; it does not calculate or persist authoritative financial state.

## Run locally

From this directory:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set `NEXT_PUBLIC_API_URL` when the API is not available at `http://localhost:8080/api/v1`.

For visual UI work before the API is available, opt into the clearly labelled fixture service for the current shell only:

```powershell
$env:NEXT_PUBLIC_USE_FIXTURES = "1"
npm run dev
```

Fixture mode is not a ledger and must not be used to represent financial truth. Leave the variable unset for integration and deployment.

## Checks

```bash
npm run lint   # Type-aware Next.js lint checks
npm run build  # Production build and route validation
```

## Structure

- `src/app/` — routes and layouts
- `src/components/` — accessible, reusable UI and financial display components
- `src/lib/api.ts` — the only browser-to-API boundary
- `src/lib/fixtures.ts` — opt-in, visibly labelled visual fixtures

Refer to `docs/design-system.md` for the visual tokens and `docs/frontend-screens.md` for the route and component specification.
