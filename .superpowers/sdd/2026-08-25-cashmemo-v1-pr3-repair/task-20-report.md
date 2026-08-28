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

## Fix round 1 (2026-08-28)

### Reviewer findings addressed

- `walletSchema(exponent)` now validates the opening-balance lexical decimal without `Number`/`parseFloat`: ASCII non-negative values only, with trailing-zero normalization for effective fractional scale. USD exponent 2 accepts `1.2300` and rejects `1.231`; exponent 0 accepts `100.0` and rejects `100.1`. The form obtains the authoritative currency exponent from the registry and keeps the exact accepted input string in the request.
- Category Expense and Income each render a matching generated `TabsContent`; Base UI supplies `tabpanel`, `aria-labelledby`, and trigger `aria-controls`. Tests exercise switching by keyboard.
- Archive failures stay inside the consequence Dialog as `role="alert"`; delete errors inspect `response.status`, using reference-conflict copy only for 409 and generic contextual copy for network/401/404/500 while retaining the row.
- Embedded wallet/category forms opt out of the standalone `.dialog` surface; focused visual-structure assertions ensure the generated Dialog owns border/background/shadow/padding.
- Task20 browser coverage now creates a real transaction, budget, and dependent recurring rule. It records monthly income/expense/net plus budget snapshot, proves opening-balance edit changes wallet balance only, and verifies recurring Active → Paused after archive → still Paused after restore. It also exercises Dialog focus, Tabs keyboard navigation, reduced motion, and a 390×844 mobile viewport.

### Behavioral RED evidence against base

In a detached temporary worktree at `08571c4540f91e6624fe82012085ba3dd36769c6`, I added only a disposable test asserting the approved USD precision rule, then ran:

```text
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run tests/task20-base-red.spec.ts --reporter=dot
```

Result: `1 failed`; base `walletSchema` returned `true` for `opening_balance: "1.231"` while the test expected `false` (`AssertionError: expected true to be false`). The prior test expectation and implementation treated opening balance as immutable and only non-empty. That contradicted the approved editable-opening-balance contract and Rust exponent validation. The corrected test now protects editable opening balance, non-negative lexical parsing, normalized trailing-zero scale, and currency exponent boundaries.

### Fix-round RED/GREEN and verification evidence

- RED focused run after adding reviewer tests: `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run tests/wallets.spec.tsx tests/categories.spec.tsx` failed with 5 behavior failures (schema factory missing, missing Income tabpanel, archive error outside dialog, and generic delete mapping absent). After minimum fixes, the same focused command passed `2 files / 22 tests`.
- `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm toolchain:check` → `Toolchain verified: node=24.14.0, pnpm=11.13.1`.
- `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web lint` → passed with `--max-warnings 0`.
- `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web typecheck` → route types generated; `tsc --noEmit` passed.
- `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run` → `16 files, 165 tests passed`.
- `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web build` → optimized production build passed; all app routes generated.
- `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec playwright test e2e/wallets-categories.spec.ts --workers=1` → `2 passed (1.1m)` under fresh disposable Postgres/Mailpit/API services; services cleaned with `docker-compose -f infra/v1/test-compose.yml down --remove-orphans`.

## Self-review / concerns

- Backend remains authoritative for delete eligibility; client only renders server error context.
- Currency is disabled in edit mode; opening balance remains enabled and is not represented as a transaction.
- Archive/restore invalidation intentionally differs: archive includes recurring queries; restore does not.
- One initial E2E attempt hit host `ENOSPC` while Next copied an optional sharp binary; generated `.next` output was removed and the retry passed. No tracked files were affected.

## Fix round 2 (2026-08-28)

### Findings addressed

- Wallet form submission now requires a loaded, non-error currency registry and a matching authoritative exponent. The submit control stays disabled while registry data/precision is unavailable. Currency/exponent changes trigger full-form exact-string revalidation, preventing a stale exponent from accepting `1.231` for USD or a fractional value for exponent-zero currencies. No numeric coercion is used.
- E2E now snapshots the actual transaction row count/content immediately after creating the transaction and rechecks it after opening-balance edit, wallet archive, and wallet restore, alongside the selected-month summary and budget invariants.
- Detached-base behavioral RED now proves both approved editability and immutable currency: base `08571c4` fails the opening-balance-enabled assertion while currency remains disabled.
- Browser checks assert menu-launched Dialog focus returns after Save, Escape, Cancel, and generated Close; mobile 390×844 asserts no horizontal overflow and reaches primary, form, and destructive controls. Base UI owns focus trapping/restoration; no custom focus manager was added.
- `Show archived` now sits directly beside the category Tabs controls before the panel list. The E2E title now says “without changing history.”

### Round-2 RED/GREEN evidence

- Added delayed-registry and USD→zero-exponent currency-switch tests first. Pre-fix focused run: `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run tests/wallets.spec.tsx --reporter=dot` → expected new assertions failed (`2 failed | 11 passed`), including missing exponent-switch alert; the initial delayed test was then made deterministic by removing a post-unmount readiness assertion.
- Against detached base `08571c4`, disposable appended test run with `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run tests/wallets.spec.tsx --reporter=dot` → `1 failed | 6 passed`; failure was `expected ... opening balance ... disabled false`, received `true`, while currency assertion passed. Temporary test/worktree was removed.
- After fixes: focused wallets/categories `2 files, 24 tests passed`; full `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run --maxWorkers=1 --reporter=dot` → `16 files, 167 tests passed`.
- `PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm toolchain:check` → `Toolchain verified: node=24.14.0, pnpm=11.13.1`.
- Node24 lint and typecheck passed; Node24 `pnpm -C apps/web build` passed with all app routes generated.
- Node24 `pnpm -C apps/web exec playwright test e2e/wallets-categories.spec.ts --workers=1` → `2 passed (1.1m)` with fresh disposable Postgres/Mailpit/API services; cleanup: `docker-compose -f infra/v1/test-compose.yml down --remove-orphans`.
