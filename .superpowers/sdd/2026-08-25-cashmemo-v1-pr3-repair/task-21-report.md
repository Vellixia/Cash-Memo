# Task 21 report: budget and recurring-rule management

- Implemented exact budget progress/status rendering, single Progress composition, archived budget category references, Base UI Select controls, Dialog edit forms, and AlertDialog deletion confirmation.
- Implemented recurring wallet/category context, status Badge/direction indicators, local DATE-only due-date formatting, future-only edit copy, pause/no-occurrence and resume/no-backfill copy.
- Added RED assertions for exact negative-zero/malformed remaining and date-only rendering; initial RED observed before fixes. Updated focused tests and E2E selection helpers for Base UI controls.
- RED command: mandated `pnpm --dir apps/web vitest ...` is unsupported by workspace pnpm (`[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL]`); equivalent `pnpm --dir apps/web exec vitest ...` used.
- GREEN: focused Vitest 16/16; full web Vitest 169/169; focused ESLint; TypeScript; Next build; representative Playwright E2E 1/1.
- `pnpm toolchain:check` passed Node 24.14.0/pnpm 11.13.1. No generated Orval files changed.
- Primitive inventory updated. Pre-existing `.claude/settings.json`, `.serena/`, `AGENTS.md`, `CLAUDE.md` intentionally untouched/unstaged.
- Self-review: no money conversion through Number/parseFloat; only bounded server progress uses existing helper. E2E initially found role collision; removed card `role=status` while preserving visible non-color status text.
- Concern: unrelated `wallets-categories.spec.ts` still uses legacy `selectOption` for older cross-slice flow; Task 21 representative E2E was migrated and passes.

## Fix round 1

- RED archived edit (old always-send behavior):

```text
pnpm --dir apps/web exec vitest run tests/budgets.spec.tsx -t "omits unchanged archived category"
FAIL ... Unable to find an element with the text: /Old Food \\(archived historical category\\)/
```

The same RED exposed raw `old-food` trigger value; after archived display was corrected, assertion
failed contractually on old payload (`category_id` present). GREEN now omits unchanged archived ID
and includes active replacement ID: focused budget test `1 passed | 8 skipped`; combined focused
suite `17 passed`.

Exact payload RED transcript after isolating display fix:

```text
AssertionError: expected { month: '2026-08', …(3) } to not have property "category_id"
Received: "old-food"
at tests/budgets.spec.tsx:247:34
```

- E2E acceptance was expanded with real ordinary transaction fixture, over-budget text/sign/value,
  budget delete, recurring edit/pause/resume/delete, and unchanged transaction snapshots. Initial
  staged E2E RED command reached no browser assertion because fresh-service startup failed:

```text
pnpm --dir apps/web exec playwright test e2e/budgets-recurring.spec.ts
Error: Process from config.webServer was not able to start. Exit code: 1
Failed to Setup IP tables ... (fork/exec /usr/sbin/iptables: input/output error)
```

Retry produced same exact Docker iptables failure after scoped `docker-compose -f infra/v1/test-compose.yml down --remove-orphans` cleanup. Prior round's pre-expansion E2E was `1 passed`; expanded acceptance remains blocked by Docker host networking.

- Fix-round passing commands: `pnpm toolchain:check` (`Toolchain verified: node=24.14.0, pnpm=11.13.1`), focused ESLint, TypeScript, and `pnpm --dir apps/web exec vitest run tests/budgets.spec.tsx tests/recurring.spec.tsx` (`Test Files 2 passed; Tests 17 passed`).

## Fix round 1 RED recheck (fresh)

Archived payload RED was reproduced by temporarily restoring the pre-fix always-send payload,
then restoring the fix:

```text
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir apps/web exec vitest run tests/budgets.spec.tsx -t "omits unchanged archived category"
 ❯ tests/budgets.spec.tsx (9 tests | 1 failed | 8 skipped) 362ms
     × omits unchanged archived category on edit and sends active replacement 361ms
AssertionError: expected { month: '2026-08', …(3) } to not have property "category_id"
- Expected:
undefined
+ Received:
"old-food"
 ❯ tests/budgets.spec.tsx:247:34
 Test Files  1 failed (1)
 Tests  1 failed | 8 skipped (9)
 exit=1
```

Baseline browser-acceptance RED was reproduced against reviewed implementation `b693e36609bdd4975e7e7ebe758feea6fce91bf6` with this exact probe:

```text
$ baseline=$(git show b693e36609bdd4975e7e7ebe758feea6fce91bf6:apps/web/e2e/budgets-recurring.spec.ts); missing=0; for assertion in 'createTransaction' 'Over budget' 'Confirm delete' 'toHaveAttribute("aria-valuenow", "100")' 'page.getByLabel("Amount").fill("18.00")' 'toHaveText(ordinaryText)' '2030-01-02'; do if ! printf '%s\n' "$baseline" | rg -q -F "$assertion"; then printf 'MISSING required E2E assertion: %s\n' "$assertion"; missing=1; fi; done; printf 'exit=%s\n' "$missing"
MISSING required E2E assertion: createTransaction
MISSING required E2E assertion: Over budget
MISSING required E2E assertion: Confirm delete
MISSING required E2E assertion: toHaveAttribute("aria-valuenow", "100")
MISSING required E2E assertion: page.getByLabel("Amount").fill("18.00")
MISSING required E2E assertion: toHaveText(ordinaryText)
MISSING required E2E assertion: 2030-01-02
exit=1
```

Current browser source probe is GREEN: `GREEN: all Task 21 browser acceptance assertions present`.

## Fix round 1 GREEN recheck (fresh)

```text
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir apps/web exec playwright test e2e/budgets-recurring.spec.ts
  ✓  1 [chromium] › e2e/budgets-recurring.spec.ts:16:1 › updates a server-owned budget and pauses then resumes a recurring rule (18.1s)
  1 passed (32.5s)
```

The first live run exposed only a whitespace presentation mismatch in the test's `innerText`
snapshot after navigation; the test now compares stable row `textContent` and `aria-label` values.
Fresh disposable `v1-postgres-1` and `v1-mailpit-1` services were stopped and removed with
`docker-compose -f infra/v1/test-compose.yml down --remove-orphans`.

Additional fresh checks:

- `pnpm --dir apps/web exec vitest run tests/budgets.spec.tsx tests/recurring.spec.tsx`: 2 files,
  17 tests passed.
- `pnpm --dir apps/web exec vitest run`: 16 files, 170 tests passed.
- `pnpm --dir apps/web lint`: exit 0.
- `pnpm --dir apps/web typecheck`: exit 0.
- `pnpm --dir apps/web build`: production build exit 0.
- `pnpm toolchain:check`: Node 24.14.0 / pnpm 11.13.1 verified.

## Fix round 2: generated-transaction immutability

The prior manual `POST /api/v1/transactions` fixture was rejected with a focused RED
probe requiring recurrence linkage:

```text
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir apps/web exec playwright test e2e/budgets-recurring.spec.ts
  ✘  1 [chromium] › e2e/budgets-recurring.spec.ts:36:1 › updates a server-owned budget and pauses then resumes a recurring rule (8.1s)
Error: ordinary transaction must be generated
expect(received).toBeTruthy()
Received: undefined
apps/web/e2e/budgets-recurring.spec.ts:51:96
  1 failed
```

This was the correct RED: the manual transaction had no `recurring_occurrence_id`.
The API transaction serializer does not expose that linkage, so the GREEN uses the
test-only DB-safe inspection helper (no production endpoint or fake row): it asserts
one transaction row, one non-null occurrence linkage, and one distinct occurrence.
The browser snapshots transaction identity and all financial fields through the real
API, then edits, pauses, resumes, and re-reads it; the same one-row/one-occurrence
assertion proves no duplicate or backfill.

Processor command and environment used by the E2E helper:

```text
CASHMEMO_V1_APP_ENV=test
CASHMEMO_V1_DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e
cargo run -p cashmemo-api --bin cashmemo-api -- process-recurring --batch-size 1 --max-occurrences-per-recurring-transaction 1
=> {"command":"process-recurring","processed":1}
```

The recurrence uses deterministic local DATE-only `2000-01-01` and daily cadence,
avoiding UTC-derived JavaScript `Date` values while making exactly one due occurrence
processable against the real current local date. The budget flow now fetches the
server budget collection after confirmed deletion and asserts zero records.

Fix-round-2 GREEN on fresh disposable services (removed with
`docker-compose -f infra/v1/test-compose.yml down --remove-orphans`):

```text
$ PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH pnpm --dir apps/web exec playwright test e2e/budgets-recurring.spec.ts
process-recurring: CASHMEMO_V1_APP_ENV=test CASHMEMO_V1_DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e cargo run -p cashmemo-api --bin cashmemo-api -- process-recurring --batch-size 1 --max-occurrences-per-recurring-transaction 1 => {"command":"process-recurring","processed":1}
  ✓  1 [chromium] › e2e/budgets-recurring.spec.ts:36:1 › updates a server-owned budget and pauses then resumes a recurring rule (15.0s)
  1 passed (32.0s)
```

Targeted ESLint and `git diff --check` also pass after the helper cleanup. Full Node24
Vitest/lint/typecheck/build remain the passing fix-round-1 results above; they will be
rerun for the final signed Task 21 commit.
