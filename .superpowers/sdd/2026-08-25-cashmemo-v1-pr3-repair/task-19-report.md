# Task 19 Report: Compact transaction history, semantic filters, and Trash

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`
Base SHA: `2442f6d79bf27e8165a37225e018ecbf1e3cdc41`
Implementation commit: `cbbe35c` (signed; final SHA updated below)

## Scope and files

Changed only Task 19 web surfaces, focused tests, E2E regression, primitive inventory, and this
report:

- `apps/web/components/ui/dropdown-menu.tsx`
- `apps/web/components/ui/alert-dialog.tsx`
- `apps/web/components/ui/badge.tsx`
- `apps/web/features/transactions/filters.tsx`
- `apps/web/features/transactions/history-params.ts`
- `apps/web/features/transactions/history.tsx`
- `apps/web/features/transactions/query-keys.ts`
- `apps/web/features/transactions/trash.tsx`
- `apps/web/app/globals.css`
- `apps/web/tests/history.spec.tsx`
- `apps/web/tests/trash.spec.tsx`
- `apps/web/e2e/history-trash.spec.ts`
- `docs/verification/v1-pr3-ui-primitive-inventory.md`

No `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, `.serena/`, generated API file, or server
file was edited or staged.

## RED evidence

Before implementation, focused Vitest run was intentionally failing 5 tests: semantic date/q
contract, ephemeral search, confirmation-free Trash, and scheduled purge copy. Existing baseline
had passed 8/8 with the old behavior. The original implementation focused GREEN was `9/9`; the
round-1 follow-up expanded that focused suite to `13/13`.

## Generator and substrate audit

Pinned `shadcn` CLI reported `4.19.0`. `dropdown-menu`, `alert-dialog`, and `badge` were generated.
CLI prompted about existing `button.tsx`; answer was no, preserving Task 14 Button. All three
new files use Base UI-backed generated primitives. Existing Task 16 Base UI Sheet is reused for
mobile filters. No raw/homemade menu or dialog, duplicate Button, Radix-era primitive, or Orval
edit was introduced.

## History/filter implementation

- Rows are compact neutral list rows, not mobile cards. They show current wallet/category names,
  note, exact `MoneyAmount`, explicit Income/Expense direction, Cashmemo timezone date/time,
  accessible row edit navigation, visible focus-compatible links, and non-color `Future` Badge.
- Overflow actions use generated accessible DropdownMenu. Mobile secondary actions remain there;
  row tap opens `/app/transactions/{id}/edit`.
- `from`/`to` stay semantic inclusive `YYYY-MM-DD` request values. URL state is restricted to
  `from`, `to`, `type`, `wallet`, `category`; `q` is local React state and cursor is local state.
  A legacy URL `q` is removed via replace.
- Mobile Sheet edits draft filters/search and commits one Apply or Clear-all URL update. Desktop
  structured controls update URL directly; search remains ephemeral.
- Filter/search changes clear loaded pages and opaque cursors. Load more appends deduplicated rows;
  failed next pages retain existing rows and expose retry for the failed cursor only.

## Trash lifecycle and invalidation

- Ordinary Move to Trash has no confirmation and removes row only after server success.
- Success shows status plus Sonner action-backed Undo. A ref guard prevents duplicate restore;
  restore failure keeps Undo/item state and presents persistent error status.
- Trash rows show current names, exact amount, occurrence time, `deleted_at`, and configured-timezone
  purge date. Copy says “Scheduled for automatic deletion after …” without an exact guarantee.
- Delete forever is the only AlertDialog-confirmed action. It removes after server success and uses
  lifecycle-only history/Trash invalidation. Restore/trash use financial scope invalidation.
- `invalidateTransactionScopes` covers old/new wallet, category, month, wallet, budgets, monthly
  summary, recent/history, and Trash. `invalidateTransactionLifecycleScopes` covers history and
  Trash only for permanent deletion.
- Archive remains a separate lifecycle and is untouched by this task.

## GREEN verification

- `cd apps/web && pnpm vitest run tests/history.spec.tsx tests/trash.spec.tsx` → original
  implementation `2 files`, `9/9`; round-1 follow-up `2 files`, `13/13`.
- `cd apps/web && pnpm lint` → exit 0, no warnings/errors.
- `cd apps/web && pnpm typecheck` → exit 0 after serial rerun (one parallel build/typegen race
  transiently produced missing `.next/types/*`).
- `cd apps/web && pnpm build` → exit 0; all app routes compiled.
- `cd apps/web && pnpm exec playwright test e2e/history-trash.spec.ts` → Chromium `1 passed`;
  fresh Postgres/Mailpit/API services used synthetic named user data.
- Original verification used shell Node `v22.19.0`; round-1 reran the required pinned Node
  `24.14.0` path and `pnpm toolchain:check` passed.
- First E2E attempt exposed stale `23.50 USD` selector after MoneyAmount’s canonical `USD 23.50`
  order; selector was corrected and the full browser test rerun passed.

## Responsive/a11y review

CSS provides compact desktop rows and stacked 375px mobile rows, hides desktop filter fieldset on
mobile, and exposes Sheet trigger. Generated Sheet/Menu/AlertDialog primitives supply dialog/menu
roles and focus handling. Direction, Future, Trash, and amounts have text/accessible labels; no
color-only financial meaning. Focus, loading, error, empty, success, and reduced-motion base rules
remain covered by existing global CSS and focused component tests.

## Contradictions and self-review concerns

- Original implementation verification used Node 22.19.0; round-1 verification used the required
  pinned Node 24.14.0 toolchain (evidence below).
- Existing API contract has no timezone field on history rows, so UI reads authenticated timezone
  through `useGetOnboarding` and gates all date content until it is ready.
- Round-1 browser regression adds injected restore failure and permanent Delete forever coverage.
- Existing query invalidation helper always invalidates Trash for financial mutations; this is safe
  but broader than the lifecycle-only permanent-delete helper.

## Round 1/5 repair follow-up

### Scope and RED evidence

Round 1 addressed four review findings only: the Sonner Undo callback captured the pre-trash
`undefined` state; financial mutations omitted the broad unfiltered history key; history/Trash
rendered UTC while authenticated timezone data was pending or failed; and browser regression
coverage lacked semantic pagination and lifecycle failure paths. Four new focused tests were added
first and observed RED: restore was called zero times from the Sonner action, the broad history
key was absent, and both history and Trash rendered date content without a ready timezone. A
second timezone failure assertion covered the explicit error/retry state. The focused suite is now
`13/13` GREEN; the full web Vitest suite is `148/148` GREEN.

### Repair implementation

- Trash success passes the exact trashed transaction to a stable Sonner Undo callback. A ref and
  state-backed pending flag make restore idempotent and expose `disabled`/`aria-busy` while active.
- Financial trash/restore invalidation now includes the broad `getListTransactionsQueryKey()` plus
  existing wallet/category/month/budget/summary/recent and Trash scopes. Permanent delete retains
  lifecycle-only history/Trash invalidation.
- History and Trash no longer use a UTC fallback. Dates render only after the authenticated IANA
  timezone is available; pending state says `Loading timezone…`, and failure exposes an alert with
  `Retry timezone`. Occurrence, deleted, and purge dates are all gated.
- Chromium E2E now captures semantic inclusive `from`/`to` transport, proves structured filters
  while `q` stays absent from the URL, injects an opaque cursor page to prove Load more retention,
  clicks the real Sonner server Undo, injects a safe 503 restore failure and retries, and confirms
  Delete forever through AlertDialog. The interceptor forwards to the real API and modifies only
  the synthetic list-page response; no production bypass exists.

### Round 1 GREEN and audits

- `/Users/andresholivin/.nvm/versions/node/v24.14.0/bin` + `pnpm toolchain:check` → Node
  `24.14.0`, pnpm `11.13.1`.
- `cd apps/web && pnpm vitest run tests/history.spec.tsx tests/trash.spec.tsx` → `13/13`.
- `cd apps/web && pnpm vitest run` → `16 files`, `148/148`.
- `cd apps/web && pnpm lint` → exit 0.
- `cd apps/web && pnpm typecheck` → exit 0.
- `cd apps/web && pnpm exec playwright test e2e/history-trash.spec.ts --project=chromium` →
  Chromium `1 passed` in `39.8s`, fresh named Postgres/Mailpit/API services.
- `pnpm build` completed successfully as the Playwright web-server build; no generated API,
  server, production, or unrelated instruction paths were changed.

### Invalidation map and responsive/a11y review

Trash and restore invalidate broad history, targeted old/new wallet/category/month scopes, wallet
lists, budgets, monthly summary, recent transactions, and Trash. Permanent deletion invalidates
history and Trash lifecycle keys only. Rows remain compact at mobile and desktop widths; pending
restore/delete controls expose disabled and `aria-busy`; generated Base UI menu/dialog/sheet
primitives provide accessible roles/focus behavior; dates use authenticated IANA timezone; q and
opaque cursors never enter URL/history. Existing reduced-motion and focus/loading/error/empty/success
styles remain in force.

### Contradiction evidence and concerns

The first browser interceptor attempt returned a Next 404 because it bypassed the existing test
bridge; it was corrected to forward every matched request to the configured API origin, then the
cursor synthetic page returned 200 and the complete browser test passed. A 503 response body is
normalized by the API client to `Request failed with status code 503`, so the E2E asserts the
persistent status code rather than an unexposed server message. Existing dirty `.claude/settings.json`,
`AGENTS.md`, `CLAUDE.md`, and `.serena/` paths remain untouched and unstaged.

A later parallel lint/typecheck/build attempt hit a generated `.next` race and `ENOSPC` while
copying standalone Sharp assets. The cache was removed, typecheck was rerun serially and passed;
the preceding fresh-service E2E web-server build had already completed successfully.

## Final commits

- Round-1 implementation and verification: `633325a` (signed; Good signature from
  `andres (personal-mac) <andresholivin01@gmail.com>`).
- This report SHA is recorded by the signed report follow-up commit immediately after this change.
