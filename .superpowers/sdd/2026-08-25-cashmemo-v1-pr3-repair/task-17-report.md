# Task 17 Report — Currency-separated dashboard and exact money

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`
Base SHA: `22a3d1ef360fbd9cbdc3498e3b4ce5d6792e4194`
Implementation SHA: `cba4f742f18f2bf37bcbbe3c764aed71ee863427`
Commit: signed (`git show --show-signature HEAD` → Good signature, EDDSA key `C07803C796C084B1DCEF44F88A4D51F050B1D09F`)

## Files

- Added `apps/web/components/ui/progress.tsx` via pinned shadcn CLI.
- Added `apps/web/components/money/exact-decimal.ts`.
- Updated money components, dashboard/budget compositions, dashboard/budget tests, `app/globals.css`, and UI primitive inventory.
- No Orval-generated file edited. No `pnpm-lock.yaml` change.
- Unrelated `.claude/settings.json`, `.serena/`, `AGENTS.md`, and `CLAUDE.md` remained unstaged and untouched.

## RED Evidence

1. Added exact-money RED test for huge signed decimal, canonical scale, grouping, and explicit Income/Expense accessible meaning.
2. Added RED assertions for month params on all three report hooks, category share progress, and currency-local sections.
3. Mandated `pnpm --dir apps/web vitest run tests/dashboard.spec.tsx tests/budgets.spec.tsx` was blocked by local pnpm invocation behavior: `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "apps/web" not found`. Equivalent pinned pnpm command `pnpm -C apps/web exec vitest run ...` ran RED: 3 failing tests (missing `MoneyAmount`, recent month param, missing category progress).

## Generator Audit

Ran `pnpm --dir apps/web exec shadcn add progress` with CLI `4.19.0`; generated Base UI `@base-ui/react/progress` component. `Progress` is used for category share and budget visual progress. No Radix-era composition, native progress fallback, or second progress substrate added.

## Exact Algorithm

`splitExactDecimal` validates canonical signed decimal strings without numeric coercion, splits sign/whole/fraction, groups whole digits with a string regex, and preserves fractional scale. `MoneyAmount` renders the exact grouped string, visible currency/sign, explicit direction metadata, and an accessible label. It never calls `Number`, `parseFloat`, or `Intl` on authoritative amount. Invalid strings remain unchanged for safe display. `boundedPercentage` is used only for server-derived graphical percentages; values clamp to `[0, 100]` while canonical text stays server-provided.

## Month, Query, Currency, State Behavior

- Dashboard reads valid `?month=YYYY-MM` when no server initial month is supplied and writes picker changes with `history.replaceState`.
- Same `{ month }` params feed monthly summary, budget summary, and recent transactions; query keys therefore isolate month caches.
- Summary and budget sections group independently by currency with unique heading IDs. No combined currency total or shared chart scale exists.
- Category bars use only server `share_percent`; displayed percentage remains exact server string.
- Monthly, budget, and recent endpoints render local stable Skeleton regions, local retryable errors, and independent successful siblings.
- Empty monthly activity, no budgets, and no recent transactions use distinct copy/actions.

## GREEN / Accessibility / Build

- `pnpm -C apps/web exec vitest run tests/dashboard.spec.tsx tests/budgets.spec.tsx tests/accessibility.spec.tsx`: 23/23 passed.
- `pnpm -C apps/web exec tsc --noEmit`: passed.
- Scoped ESLint command with `--max-warnings 0`: passed.
- `pnpm -C apps/web build`: passed.
- `git diff --check`: passed.
- Keyboard/focus semantics retained through existing visible focus ring; progress bars expose role, labels, valuetext, and bounded valuenow. Direction/status text supplements color. Existing reduced-motion global rule covers generated progress transition.

## Visual Slice Review

Static review covered dashboard mobile/desktop grid behavior (`repeat(auto-fit, minmax(...))`), stacked category rows, wrapping management cards, independent currency cards, stable Skeleton region heights, visible focus styles, and reduced-motion transition override. No horizontal-scale coupling or cross-currency hero found.

## Inventory / Contradictions / Self-review

Updated `docs/verification/v1-pr3-ui-primitive-inventory.md` with Task 17 generated foundation, substrate audit, and composition ownership. Existing Task 14–16 entries were preserved without reformatting.

Known environment concern: `node --version` reported `v22.19.0`, while task pins Node `24.14.0`; `pnpm --version` matched `11.13.1`. Tests/build/typecheck/lint passed under available runtime. No product contradiction found. Remaining concern: `BudgetProgress` uses same bounded decimal percentage helper for graphical clamp because Base UI Progress requires numeric `value`; authoritative money itself remains string-only.

## Fix Round 1/5 — URL month request race

Date: 2026-08-28

RED tests added before production change:

- Valid `?month=2026-07` must be first argument to monthly, budget, and recent hooks on first render.
- Invalid `?month=2026-13` must pass `undefined` to all hooks and clean `month` from URL.
- Picker change must update URL and all three query params.

RED evidence: under explicit Node 24.14.0, focused URL tests initially failed with first hook param `undefined` for valid URL and stale `?month=2026-13` after invalid render.

Fix: `useSearchParams` synchronously seeds state before hook calls. `validMonth` enforces `YYYY-MM` plus month `01..12`; invalid URL month disables all month requests, then effect removes only invalid `month` while preserving other query keys. Picker validates before state/query update and uses `history.replaceState` without reload.

GREEN evidence: `pnpm toolchain:check` verified Node 24.14.0/pnpm 11.13.1; dashboard/budget/accessibility suite 25/25 passed; scoped Prettier, ESLint, TypeScript, and Next build passed. No generated files changed. Minors deferred.
