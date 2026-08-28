# Task 20 report: wallet and category management

Date: 2026-08-28  
Branch: `rewrite/cashmemo-v1`  
Base: `08571c4540f91e6624fe82012085ba3dd36769c`

## Implementation

- Replaced homemade `Dialog` with pinned shadcn/Base UI Dialog and added generated Tabs.
- Rebuilt wallet rows with exact `MoneyAmount`, DropdownMenu actions, Dialog editor, read-only currency, editable exact opening balance, server errors, pending states, archive side-effect copy, and AlertDialog hard-delete confirmation.
- Opening-balance edits send only changed optional fields and invalidate wallet list/detail scopes; archive additionally invalidates entry defaults and recurring rules; restore never resumes rules.
- Rebuilt category rows with one Expense/Income Tabs level, `Show archived` toggle, Dialog editor, compact rows, archive consequence copy, restore-without-resume, and authoritative hard-delete conflict messaging.
- Added focused component coverage and browser coverage; updated primitive inventory, marking homemade Dialog superseded.

## Files

`apps/web/components/ui/dialog.tsx`, `apps/web/components/ui/tabs.tsx`, `apps/web/features/wallets/wallet-list.tsx`, `apps/web/features/wallets/wallet-form.tsx`, `apps/web/features/categories/category-list.tsx`, `apps/web/features/categories/category-form.tsx`, `apps/web/tests/wallets.spec.tsx`, `apps/web/tests/categories.spec.tsx`, `apps/web/e2e/wallets-categories.spec.ts`, `apps/web/app/globals.css`, `docs/verification/v1-pr3-ui-primitive-inventory.md`.

## RED evidence

- `pnpm toolchain:check` failed before implementation: `Toolchain mismatch: node=22.19.0 (expected 24.14.0), pnpm=11.13.1 (expected 11.13.1)`.
- Exact brief command `pnpm --dir apps/web vitest run tests/wallets.spec.tsx tests/categories.spec.tsx` failed in this pnpm environment with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` / `Command "apps/web" not found`.
- Existing focused tests passed 13/13 before behavior changes; old assertions encoded superseded behavior (opening balance disabled and inline action buttons). Corrected expectations now assert editable opening balance, generated dialogs, menus, and archived toggle.

## GREEN evidence

- `pnpm -C apps/web exec vitest run tests/wallets.spec.tsx tests/categories.spec.tsx`: 15/15 passed.
- `pnpm -C apps/web exec vitest run`: 16 files, 158 tests passed.
- Full ESLint command with `--max-warnings 0`: passed.
- `pnpm -C apps/web typecheck`: passed.
- `pnpm -C apps/web build`: passed.
- `pnpm -C apps/web exec playwright test e2e/wallets-categories.spec.ts`: 2 Chromium tests passed in 32.0s. Playwright started disposable API/Postgres/Mailpit services and shut them down with the web servers after completion.

## Self-review / concerns

- Backend remains authoritative for delete eligibility; client only renders server error context.
- Currency is disabled in edit mode; opening balance remains enabled and is not represented as a transaction.
- Archive/restore invalidation intentionally differs: archive includes recurring queries; restore does not.
- Required Node 24.14.0 is unavailable in current environment; browser service startup may therefore be environment-blocked.
