# Cashmemo V1 PR3 Task 14 UI Primitive Inventory

Date: 2026-08-27
Branch: `rewrite/cashmemo-v1`
Base/starting SHA: `d336ac812adb56b5485f58502d48cd83609361d0`
Pinned CLI source: `pnpm view shadcn version --json`
Pinned CLI version: `4.19.0`

## Inventory Commands

```bash
rg -n 'components/ui/(button|input|dialog|form-field)|<select\b|className=.*button-|className=.*input|confirm\(' apps/web --glob '!generated/**'
rg -n '^\.button-|^\.input|\[role="dialog"\]|aria-modal' apps/web --glob '*.{css,tsx}'
rg -n '<select\b|confirm-box|button-primary|button-secondary|button-danger|button-quiet|className=\"[^\"]*(button|input)' apps/web
```

## Legacy Surface

| Surface | Paths / consumers | Classification | Owner |
| --- | --- | --- | --- |
| `components/ui/button.tsx` legacy wrapper | imported by auth, onboarding, wallets, categories, budgets, recurring, transactions, settings, deletion pages | replace now with Base UI-backed compat API | Task 14 |
| `components/ui/input.tsx` legacy wrapper | imported by auth, wallets, categories, budgets, recurring, transactions, settings | replace now with Base UI-backed compat API | Task 14 |
| `components/ui/form-field.tsx` | imported by auth, onboarding, wallets, categories, budgets, recurring, transactions, settings, tests | retain for now; still needed by current slices; future field integration deferred | Tasks 15–23 |
| `components/ui/dialog.tsx` | current local wrapper only; no active imports in Task 14 inventory | retain for now; shadcn `dialog` intentionally deferred until first consumer task | Task 20 |
| Native `<select className="input">` | onboarding, recurring form, budgets, categories, wallets, transaction form/filters, preferences | retain with compat CSS; migrate to Base UI controls later | Tasks 16–23 |
| Native `<textarea className="input">` | transaction form | retain with compat CSS; migrate later | Task 18 |
| Raw `.button` link/button styling | transaction history links, dashboard retry button | retain base compat class; remove variant subclasses now | Tasks 14, 19 |
| Raw `.button-primary/.button-secondary/.button-danger/.button-quiet` selectors | only in old `globals.css`; dashboard retry button used `.button-secondary` | remove now; no consumer left after dashboard rename | Task 14 |
| Raw `.input` selector | old `globals.css` plus legacy `Input` wrapper | remove exact selector now; replace with non-shadcn native-control compat selectors | Task 14 |
| Homemade confirm boxes | categories, wallets, budgets, recurring, transactions trash/history | retain markup/CSS for now; modal/alert-dialog migration deferred | Tasks 19–21 |

## Generated Foundation Added In Task 14

| File | Source | Notes |
| --- | --- | --- |
| `apps/web/components.json` | `shadcn init` | source of generator truth; alias `@/components/ui`; CSS vars on |
| `apps/web/lib/utils.ts` | `shadcn init` | `cn()` helper for generated components |
| `apps/web/components/ui/button.tsx` | `shadcn init`, then compat theming | Base UI-backed via `@base-ui/react/button`; supports existing `primary/secondary/quiet/danger` callers |
| `apps/web/components/ui/input.tsx` | `shadcn add input --overwrite --yes` | Base UI-backed via `@base-ui/react/input`; 44px minimum target |
| `apps/web/components/ui/card.tsx` | `shadcn add` | first-foundation card |
| `apps/web/components/ui/label.tsx` | `shadcn add` | first-foundation label |
| `apps/web/components/ui/separator.tsx` | `shadcn add` | Base UI-backed separator |
| `apps/web/components/ui/skeleton.tsx` | `shadcn add` | first-foundation loading primitive |
| `apps/web/components/ui/sonner.tsx` | `shadcn add`, then no-dark customization | single toast host; light-only |

## Substrate Audit

- Interactive generated primitives are Base UI-backed, not Radix-era snippets:
  - `button.tsx` imports `@base-ui/react/button`
  - `input.tsx` imports `@base-ui/react/input`
  - `separator.tsx` imports `@base-ui/react/separator`
- No `asChild` composition added.
- No parallel second button/input implementation introduced.
- `dialog`, `field`, `select`, `textarea`, `combobox`, `alert-dialog`, `tabs`, `progress`, and sidebar remain deferred until their first consumer tasks.

## Direct Compatibility Corrections Outside Brief File List

| File | Why |
| --- | --- |
| `apps/web/vitest.config.ts` | generated `@/` imports need alias resolution in Vitest to run Task 14 RED/GREEN |
| `apps/web/features/dashboard/dashboard.tsx` | renamed one raw `button-secondary` consumer and fixed stale `useGetRecentTransactions` call shape surfaced by frozen Orval contracts |
| `apps/web/tests/transaction-form.spec.tsx` | added newly required `wallet_name` / `category_name` fixture fields so Task 14 `typecheck`/`build` can pass against frozen contract types |

## Deferred Removes

- `components/ui/form-field.tsx`
- `components/ui/dialog.tsx`
- native selects / textarea
- confirm-box patterns
- `.button` link compatibility class

Those remain intentionally until Tasks 15–23 migrate actual consumers.
