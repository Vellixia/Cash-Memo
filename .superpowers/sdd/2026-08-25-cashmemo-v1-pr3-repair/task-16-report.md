# Task 16 Report — Responsive shell and durable onboarding UX

Plan: `docs/superpowers/plans/2026-08-25-cashmemo-v1-pr3-repair.md` (Task 16)
Design: `docs/superpowers/specs/2026-08-25-cashmemo-v1-pr3-repair-design.md`

## Recovery state

```
$ git branch --show-current
rewrite/cashmemo-v1

$ git rev-parse HEAD
abbd48cffe7a3b30539bc7a2734bb18b07888969

$ git status --short
 M .claude/settings.json
 M apps/web/tests/accessibility.spec.tsx
 M apps/web/tests/onboarding.spec.tsx
?? .serena/
?? AGENTS.md
?? CLAUDE.md
?? apps/web/components/ui/combobox.tsx
?? apps/web/components/ui/input-group.tsx
?? apps/web/components/ui/sheet.tsx
?? apps/web/components/ui/textarea.tsx
```

Controller-owned untouched paths honoured: `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`,
`.serena/`.

Pinned toolchain evidence:

```
$ node -v
v22.19.0

$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm toolchain:check
Toolchain verified: node=24.14.0, pnpm=11.13.1
```

Command-form contradiction found early:

```
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir apps/web vitest run tests/onboarding.spec.tsx tests/accessibility.spec.tsx
undefined
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "apps/web" not found
```

All web commands below therefore used `pnpm -C apps/web exec …` or `pnpm -C apps/web …`.

## Files changed

- `apps/web/app/globals.css`
- `apps/web/components/app-shell/bottom-nav.tsx`
- `apps/web/components/app-shell/sidebar.tsx`
- `apps/web/components/full-access-app-shell.tsx`
- `apps/web/components/ui/combobox.tsx`
- `apps/web/components/ui/input-group.tsx`
- `apps/web/components/ui/sheet.tsx`
- `apps/web/components/ui/textarea.tsx`
- `apps/web/e2e/auth-onboarding.spec.ts`
- `apps/web/e2e/support/auth.ts`
- `apps/web/features/onboarding/onboarding-flow.tsx`
- `apps/web/features/onboarding/timezones.ts`
- `apps/web/features/onboarding/use-onboarding.ts`
- `apps/web/tests/accessibility.spec.tsx`
- `apps/web/tests/onboarding.spec.tsx`
- `docs/verification/v1-pr3-ui-primitive-inventory.md`

## RED evidence

Focused RED command:

```
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run tests/onboarding.spec.tsx tests/accessibility.spec.tsx
Test Files  2 failed (2)
Tests  17 failed | 4 passed (21)
```

Observed failure causes matched missing Task 16 implementation, not broken tests:

- shell still rendered `History` label, desktop Add inside primary nav, and mobile nav links
  `Overview / History / Add / Budgets / Recurring / Settings`;
- no mobile `More` button or dialog existed;
- `.bottom-nav` still used `overflow-x: auto` and no `--bottom-nav-height` safe-area contract
  existed in `globals.css`;
- onboarding still imported `useSeedOnboardingCategories`, still derived `categories` as a visible
  step, and still used `datalist` timezone input instead of searchable exact-IANA combobox.

Exact representative failures:

```
FAIL tests/accessibility.spec.tsx > app shell navigation > names every desktop destination once with a route-driven Add action
  expected [ 'Overview', 'History', 'Add', … ] to deeply equal [ 'Overview', 'Transactions', … ]

FAIL tests/accessibility.spec.tsx > app shell navigation > opens the More Sheet, moves focus into it, and restores focus on close
  Unable to find an accessible element with the role "button" and name "More"

FAIL tests/onboarding.spec.tsx > derived onboarding > derives exactly three visible steps from backend facts and never a category step
  expected 'categories' to be 'wallet'

FAIL tests/onboarding.spec.tsx > derived onboarding > ...
  No "useSeedOnboardingCategories" export is defined on the "../generated/api" mock
```

## Generator/substrate audit

- Preserved interrupted worker output for `sheet.tsx`, `combobox.tsx`, `input-group.tsx`,
  `textarea.tsx`. No regeneration. No version drift from pinned `shadcn` `4.19.0`.
- `sheet.tsx` uses Base UI `@base-ui/react/dialog`.
- `combobox.tsx` uses Base UI `@base-ui/react`.
- `input-group.tsx` composes existing Base UI-backed `Button`/`Input` plus generated `Textarea`.
- No second dialog/combobox/button/input substrate introduced.
- No `asChild` composition introduced.
- One icon system only: Lucide.

## Sidebar ruling

YAGNI decision recorded in `docs/verification/v1-pr3-ui-primitive-inventory.md`:

- rejected full shadcn Sidebar primitive;
- retained simple semantic desktop nav plus generated mobile `Sheet`;
- reason: static IA only, no workspace switcher, nested tree, collapse, resize, or provider state
  justified.

## Implementation

- Desktop shell now uses one semantic nav vocabulary:
  `Overview`, `Transactions`, `Wallets`, `Categories`, `Budgets`, `Recurring`, `Settings`.
- Route-driven `Add` stays outside primary desktop nav and always points to
  `/app/transactions/new`.
- Mobile shell now exposes exactly five items:
  `Overview`, `Transactions`, `Add`, `Budgets`, `More`.
- `More` opens generated `Sheet` with remaining destinations and focus restoration on close.
- `globals.css` now defines `--bottom-nav-height`, safe-area-aware bottom padding on `.app-main`,
  and five-column fixed mobile nav without horizontal scrolling.
- Onboarding derivation now ignores visible category state and uses backend facts only:
  `timezone` → `currency` → `wallet` → `/app`.
- Archived-only-wallet completed accounts stay complete on client.
- Timezone input now uses generated searchable exact-IANA `Combobox`, with detected zone first and
  exact option selection.
- Currency step now keeps explicit user choice locally, validates against the server currency
  registry, and exposes subordinate `Back` to reopen timezone editing without local step mutation.
- Loading/error/success onboarding states now use `Card`, `Alert`, `Skeleton`, and linked field
  errors.
- Focused auth/onboarding E2E helper dropped obsolete visible category step and selects timezone by
  accessible option role.

## GREEN verification

Focused GREEN:

```
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run tests/onboarding.spec.tsx tests/accessibility.spec.tsx
Test Files  2 passed (2)
Tests  21 passed (21)
```

Surrounding web gates:

```
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web lint
exit 0

$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web typecheck
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully

$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web build
✓ Compiled successfully
```

`lint` initially failed on one new `sidebar.tsx` type alias plus three Task16 test-file
assertion/style nits; those were corrected and rerun to green.

## E2E

Disposable stack:

- Compose binary: `docker-compose 5.3.1`
- Project: `cashmemo-pr3-task16-recovery`
- Ports: PostgreSQL `57436`, SMTP `1125`, Mailpit UI `8825`

Cleanup evidence:

```
$ COMPOSE_PROJECT_NAME=cashmemo-pr3-task16-recovery ... docker-compose -f infra/v1/test-compose.yml down --volumes --remove-orphans
Container cashmemo-pr3-task16-recovery-postgres-1 Removed
Container cashmemo-pr3-task16-recovery-mailpit-1 Removed
Network cashmemo-pr3-task16-recovery_default Removed
```

Focused Playwright:

```
$ COMPOSE_PROJECT_NAME=cashmemo-pr3-task16-recovery CASHMEMO_V1_E2E_POSTGRES_PORT=57436 CASHMEMO_V1_E2E_SMTP_PORT=1125 CASHMEMO_V1_E2E_MAILPIT_PORT=8825 PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec playwright test e2e/auth-onboarding.spec.ts
3 passed (33.9s)
```

One intermediate failure occurred before final green:

```
expect(locator).toBeFocused() failed
Locator: getByRole('link', { name: 'Overview' })
Expected: focused
Received: inactive
```

Cause: stale E2E assumption that focus order was `brand → Overview`. Final shell intentionally tabs
`brand → Add → Overview`. Spec corrected; product behavior unchanged.

## Responsive / a11y review

- mobile and desktop now expose same IA through direct nav + `More` sheet;
- `More` is a dialog trigger with focus entering dialog and restoring to trigger on close;
- mobile nav no longer scrolls sideways;
- `.app-main` reserves bottom-nav + safe-area space so fixed nav does not overlay content;
- Lucide only; no mixed icon systems;
- onboarding loading uses visible skeletons and `aria-live` text;
- onboarding validation and API failures stay linked/visible; success is short `status`, not hidden
  client state;
- reduced-motion CSS guard remains intact in `globals.css`.

## Inventory update

`docs/verification/v1-pr3-ui-primitive-inventory.md` now includes:

- generated Task16 primitive audit;
- explicit Sidebar YAGNI ruling;
- legacy surface retired by shell/onboarding repair;
- out-of-brief E2E helper/spec corrections.

## Contradiction evidence

- stale onboarding UI contradicted approved design by surfacing categories as a user-visible step;
  repaired to backend-idempotent invisible reconciliation.
- stale shell vocabulary contradicted approved labels by using `History`; repaired to
  `Transactions`.
- stale mobile shell contradicted approved IA by exposing `Recurring` and `Settings` directly and
  omitting `More`; repaired to five-slot nav plus sheet.
- plan literal `pnpm --dir apps/web …` contradicted actual local pnpm invocation behavior on this
  host; equivalent pinned `pnpm -C apps/web …` form used instead.

## Follow-up fix round 1 — restricted shell boundary and currency registry states

New RED added for two gaps left after first recovery:

```
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run tests/accessibility.spec.tsx tests/onboarding.spec.tsx
FAIL tests/accessibility.spec.tsx > app shell navigation > keeps the app layout free of static shell imports until full access is confirmed
FAIL tests/onboarding.spec.tsx > derived onboarding > shows an explicit currency-registry pending state and suppresses validation until ready
FAIL tests/onboarding.spec.tsx > derived onboarding > shows a retryable currency-registry error and recovers to a successful save
```

Root causes:

- `apps/web/app/(auth)/app/layout.tsx` statically imported `AppShell`, so the `/app` layout module
  graph always pulled financial shell code before `AuthGate` could redirect a restricted session.
- `onboarding-flow.tsx` treated currency-query pending/error as an empty registry, exposing invalid
  help/error copy instead of explicit loading/error states.

Implementation:

- moved `/app` layout shell loading behind `components/full-access-app-shell.tsx`, which uses
  `next/dynamic` to load `components/app-shell/app-shell.tsx` only when the full-access gate
  renders;
- added `/app` layout regression proving no static shell modules are reachable from the layout
  import graph and no shell mounts during a restricted `403` redirect;
- added explicit currency-registry pending `status`, retryable error `alert`, disabled input while
  registry is unavailable, and guarded save-path validation until registry is ready;
- extended onboarding tests to cover pending, error, retry, recovery, and successful save after
  registry recovery.

Fresh GREEN after the fix round:

```
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec vitest run tests/accessibility.spec.tsx tests/onboarding.spec.tsx
Test Files  2 passed (2)
Tests  24 passed (24)

$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web lint
exit 0

$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web typecheck
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully

$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web build
✓ Compiled successfully

$ COMPOSE_PROJECT_NAME=cashmemo-pr3-task16-fix1 CASHMEMO_V1_E2E_POSTGRES_PORT=57446 CASHMEMO_V1_E2E_SMTP_PORT=1135 CASHMEMO_V1_E2E_MAILPIT_PORT=8835 PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm -C apps/web exec playwright test e2e/auth-onboarding.spec.ts
3 passed (37.2s)
```

## Self-review / concerns

- `apps/web/playwright.config.ts` still prints pre-existing warning during E2E:
  `next start` with `output: standalone` should ideally use `node .next/standalone/server.js`.
  It did not block build or Playwright here.
- `apps/web/tests/accessibility.spec.tsx` still emits React `act(...)` warnings from
  `TransactionForm`; those warnings predate shell repair and did not fail the focused suite.
- Final task completion closed with signed commit message
  `feat: rebuild responsive shell and onboarding`.

## Exact commit message

`feat: rebuild responsive shell and onboarding`
