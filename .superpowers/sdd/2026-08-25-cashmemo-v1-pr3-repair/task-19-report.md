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
had passed 8/8 with the old behavior. After implementation and test updates, focused GREEN is
`9/9`.

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

- `cd apps/web && pnpm vitest run tests/history.spec.tsx tests/trash.spec.tsx` → `2 files`, `9/9`.
- `cd apps/web && pnpm lint` → exit 0, no warnings/errors.
- `cd apps/web && pnpm typecheck` → exit 0 after serial rerun (one parallel build/typegen race
  transiently produced missing `.next/types/*`).
- `cd apps/web && pnpm build` → exit 0; all app routes compiled.
- `cd apps/web && pnpm exec playwright test e2e/history-trash.spec.ts` → Chromium `1 passed`;
  fresh Postgres/Mailpit/API services used synthetic named user data.
- Toolchain: pnpm `11.13.1` matches; shell Node is `v22.19.0`, not required Node `24.14.0`.
- First E2E attempt exposed stale `23.50 USD` selector after MoneyAmount’s canonical `USD 23.50`
  order; selector was corrected and the full browser test rerun passed.

## Responsive/a11y review

CSS provides compact desktop rows and stacked 375px mobile rows, hides desktop filter fieldset on
mobile, and exposes Sheet trigger. Generated Sheet/Menu/AlertDialog primitives supply dialog/menu
roles and focus handling. Direction, Future, Trash, and amounts have text/accessible labels; no
color-only financial meaning. Focus, loading, error, empty, success, and reduced-motion base rules
remain covered by existing global CSS and focused component tests.

## Contradictions and self-review concerns

- Runtime Node 24.14.0 could not be selected in this shell; Node 22.19.0 evidence is reported above.
- Existing API contract has no timezone field on history rows, so UI reads authenticated timezone
  through `useGetOnboarding` and safely falls back to UTC while loading.
- Browser regression covers success restore, not an injected restore-failure transport or permanent
  delete flow; component tests cover both failure-retention paths and AlertDialog confirmation.
- Existing query invalidation helper always invalidates Trash for financial mutations; this is safe
  but broader than the lifecycle-only permanent-delete helper.

## Final commit

Updated after signed commit: `cbbe35c` (signed commit; verify with `git log --show-signature -1`).
