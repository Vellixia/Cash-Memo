# Task 18 Report: Route-driven transaction form and timezone round trip

Date: 2026-08-28
Branch: `rewrite/cashmemo-v1`
Base: `42f8d89983c1f2759b84ac0cbd30146138adda18`

## Scope and files

Implemented one create/edit form with canonical routes:

- `/app/transactions/new`
- `/app/transactions/{id}/edit`

Changed transaction form/validation, route consumers, focused Vitest/Playwright coverage, transaction history edit link, and E2E helpers. Added generated Base UI Select and RadioGroup; reused Task 16 Textarea. Removed old `/app/transactions/{id}` detail-as-edit page. Updated primitive inventory.

## RED and generator audit

The pre-Task-18 transaction suite passed while asserting legacy native selects and browser-local `occurred_at` behavior; it did not cover the approved local-minute contract. New RED assertions cover configured-zone formatting, `occurred_local`, RHF dirty update semantics, Rust field errors, direction/category filtering, wallet precision, note length, and routes.

Pinned checks: Node 22.19.0 in this shell (project brief pins Node 24.14.0), pnpm 11.13.1, shadcn 4.19.0. Generator command: `pnpm exec shadcn add select radio-group --yes`. `textarea.tsx` was reused unchanged from Task 16. No Orval/generated API files edited.

## Timezone and form behavior

- `formatUtcForTimezone` uses `Intl.DateTimeFormat(..., { timeZone, hourCycle: "h23" }).formatToParts()` to produce exact `YYYY-MM-DDTHH:mm`.
- Create sends displayed local minute as `occurred_local`; no browser timezone conversion or `new Date(local).toISOString()`.
- Edit initializes from canonical UTC `occurred_at` in configured profile timezone. RHF `dirtyFields.occurred_at` controls omission: untouched/returned-to-original datetime omits `occurred_local`; changed datetime sends exact minute.
- Rust `fields.occurred_local` 422 maps to datetime field error and linked control.
- Entry-default timezone is authoritative; defaults pending/error blocks save. Active-wallet selection is deterministic (sole active first, else active last-used, else explicit).
- Wallet changes preserve amount text; selected currency exponent revalidates amount and reports error without mutation.

## UX hierarchy, routes, accessibility

Order: Expense/Income segmented RadioGroup, prominent exact amount, wallet/currency Select, direction-compatible category Select, local datetime, note, actions. Note validation allows 501 characters to remain visible and reports the 500-character error. Inputs have visible labels, linked errors, pending/error/retry states, disabled duplicate-submit protection, keyboard-capable controls, and mobile/desktop action layout. History Edit links and browser helper use `/edit`; no modal fork.

## GREEN evidence

- `pnpm exec vitest run --reporter=dot`: 16 files, 140 tests passed.
- Focused: `tests/transaction-form.spec.tsx`, `tests/history.spec.tsx`, `tests/accessibility.spec.tsx`: 3 files, 23 tests passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with `--max-warnings 0`.
- `pnpm build`: passed; route output includes `/app/transactions/new` and `/app/transactions/[id]/edit`, excludes old detail route.
- Added real Playwright mismatch test: browser `America/Los_Angeles`, profile `Asia/Jakarta`, local input `2026-08-31T23:30`, expected UTC `2026-08-31T16:30:00Z`, reopen display `2026-08-31T23:30`. Full Playwright execution requires named disposable API/Postgres/SMTP services and was not run in this shell.

## Responsive/a11y review

375/1280 CSS review: form uses full-width controls, 44px targets, wrapped actions, and no modal-only dependency. Keyboard focus remains visible through existing design-system focus rules. RTL assertions verify labels, role alerts, linked `aria-describedby`, route-driven form landmark, and selected wallet semantics. Vitest emits one existing unwrapped-act warning in segmented-direction test; no test failure.

## Self-review and concerns

- Confirmed no unrelated `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, or `.serena/` content was read/edited/staged.
- Shell reports Node 22.19.0, while brief pins Node 24.14.0; pnpm and generated CLI match pinned versions.
- Real services-backed Playwright evidence (2026-08-28): toolchain `/Users/andresholivin/.nvm/versions/node/v24.14.0/bin` verified `node=24.14.0`, `pnpm=11.13.1` with `pnpm toolchain:check`. Pre-cleaned and post-cleaned only `COMPOSE_PROJECT_NAME=cashmemo-pr3-task18-e2e` using `infra/v1/test-compose.yml`, with Postgres `57456`, SMTP `1145`, Mailpit HTTP `8845`, `--volumes --remove-orphans`; post-clean `docker-compose ... ps -a` returned no containers.
- Command: `pnpm -C apps/web exec playwright test e2e/transactions.spec.ts`. First run exposed representation mismatch only: API returned RFC3339 UTC `2026-08-31T16:30:00+00:00`, semantically equal to required UTC `2026-08-31T16:30:00Z`; assertion changed to `new Date(...).toISOString()`. Fresh rerun passed `2 passed (32.4s)`: normal expense/income flow plus browser `America/Los_Angeles` / profile `Asia/Jakarta` proof, local input `2026-08-31T23:30`, API canonical UTC `2026-08-31T16:30:00.000Z`, edit display `2026-08-31T23:30`.
- Implementation commit: `52edb0c`; final verification assertion/report update is signed in follow-up commit returned in handoff.

## Fix round 1: review findings

Date: 2026-08-28. Fix scope: `apps/web/features/transactions/form.tsx`,
`apps/web/features/transactions/query-keys.ts`, and
`apps/web/tests/transaction-form.spec.tsx`.

### RED evidence

Added three regression groups before changing implementation:

- Delayed entry defaults started with UTC fallback, loaded `Asia/Jakarta`, changed the displayed
  `2026-08-31T23:30` to another minute, then returned to it. RED payload still contained
  `occurred_local: "2026-08-31T23:30"`, proving RHF default remained UTC.
- Archived wallet/category edit asserted read-context labels `Old Bank` / `Old Food` and note-only
  update omission. RED showed `Choose wallet`, proving active-only lists discarded historical refs.
- Boundary invalidation used UTC `2026-08-31T17:00:00Z` (September in `Asia/Jakarta`) and a
  second old/new scope. RED invalidated August report/budget keys.

### GREEN implementation

- Timezone arrival now calls RHF `resetField("occurred_at", { defaultValue })` only while field is
  clean, then validates. Dirty user text survives authoritative timezone load; change-and-return
  compares against the rebased local-minute default, omitting `occurred_local`; genuinely changed
  minutes remain sent. No browser timezone conversion or `new Date(local).toISOString()` added.
- Form builds wallet/category display options from registry plus transaction read context. Current
  archived refs remain visible and marked archived; registry currency exponent remains validation
  source. Update requests omit unchanged `wallet_id`, `category_id`, and direction, so note-only
  edits do not ask backend to re-authorize historical refs. Deliberate active selection sends changed
  id. Amount remains unchanged across wallet changes.
- `invalidateTransactionScopes` accepts configured `timezone` and derives each old/new month with
  `Intl.DateTimeFormat` parts. Form passes entry-default timezone for create/edit; old and new
  wallet/category/month scopes remain deduplicated and targeted.

### Fix-round verification

- Pinned toolchain: `node v24.14.0`, `pnpm 11.13.1`; `pnpm toolchain:check` passed.
- Focused transaction/history/accessibility: `3 files, 26 tests passed`.
- Full web Vitest serial gate: `16 files, 143 tests passed`; parallel run had two unrelated
  5-second Base UI test timeouts under contention, then passed serially with `--maxWorkers=1`.
- `pnpm -C apps/web lint`: passed (`--max-warnings 0`).
- `pnpm -C apps/web typecheck`: passed.
- `pnpm -C apps/web build`: passed; canonical `/app/transactions/new` and
  `/app/transactions/[id]/edit` routes generated.
- Real fresh services-backed Playwright: pre-cleaned and post-cleaned only
  `COMPOSE_PROJECT_NAME=cashmemo-pr3-task18-e2e` with `infra/v1/test-compose.yml`, PostgreSQL
  `57456`, SMTP `1145`, Mailpit `8845`, `--volumes --remove-orphans`. Command
  `pnpm -C apps/web exec playwright test e2e/transactions.spec.ts` passed `2 passed (1.4m)`.
  Browser context `America/Los_Angeles` / profile `Asia/Jakarta` submitted
  `2026-08-31T23:30`, observed canonical `2026-08-31T16:30:00.000Z`, reopened as
  `2026-08-31T23:30`.

### Self-review / concerns

- Archived fallback uses transaction read `wallet_name`, `category_name`, and `currency` only when
  registry omits the historical row; it does not invent ownership or active-state policy.
- Existing Base UI tests emit unwrapped-`act` warnings; no fix-round test failure remains.
- Unrelated dirty `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, `.serena/` remain untouched and
  unstaged. No Orval/generated API files changed.
