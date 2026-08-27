# Task 13 evidence report: Rust OpenAPI/Orval contract freeze

## Status and identities

Status: implementation complete in signed commit; final commit SHA is returned in task handoff.

- Branch: rewrite/cashmemo-v1
- Required base: ee60532a181ba1e26015522f840b03d081f8bffd
- Pre-work HEAD: ee60532a181ba1e26015522f840b03d081f8bffd
- git merge-base HEAD ee60532a181ba1e26015522f840b03d081f8bffd: required base SHA
- Signed implementation SHA: returned in handoff after commit

Preflight tracked tree was clean. User-owned .serena/ was present as untracked content and ignored
cache/config entries; it was reported, never read, edited, staged, or removed.

## Toolchain

Initial shell check found Node 22.19.0 and pnpm 11.13.1; required check failed:

    Toolchain mismatch: node=22.19.0 (expected 24.14.0), pnpm=11.13.1 (expected 11.13.1)
    [ELIFECYCLE] Command failed with exit code 1.

All task commands then used repository-pinned Node 24.14.0 directory first in PATH, with required
pnpm:

    node --version: v24.14.0
    pnpm --version: 11.13.1
    pnpm toolchain:check
    Toolchain verified: node=24.14.0, pnpm=11.13.1

mise exec could not install its macOS pnpm asset (no asset found: pnpm-macos-arm64); existing pnpm
11.13.1 plus pinned Node was used, and repository check passed.

## Files

- apps/api/src/openapi.rs
- apps/api/tests/openapi.rs
- openapi/cashmemo-v1.json (Rust-generated)
- apps/web/generated/api/** (Orval-generated)
- apps/web/tests/api-client.spec.ts
- docs/verification/v1-pr3-repair-evidence.md
- .superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-13-report.md

No UI architecture, UI feature, generated client, or production/deployment surface was manually
edited. Generated files changed only by pnpm api:generate.

## RED contract assertions

Added named Rust assertion repaired_dtos_publish_frozen_time_money_and_name_contracts. It checks:

- deletion/cancellation password description and password format;
- create/update occurred_local, exact minute pattern, omission semantics, and no writable occurred_at;
- canonical response occurred_at as read-only date-time;
- current wallet_name and category_name;
- required entry-default timezone;
- optional opening_balance with immutable-currency omission;
- string share_percent, exact two-decimal pattern, example, and inclusive range description;
- inclusive local from/to date parameters and selected recent month parameter.

RED run:

    cargo test -p cashmemo-api --test openapi -- --nocapture

Failed as required before schema repair:

    assertion left == right failed
    left: Null
    right: "Current password required to confirm account deletion or cancellation."
    test repaired_dtos_publish_frozen_time_money_and_name_contracts ... FAILED
    4 passed; 1 failed

Added web assertion exposes frozen repaired DTO fields in generated TypeScript, covering local write
fields, defaults timezone, current names, opening balance, exact share string, and recent month
params. Before generation, stale generated types lacked these fields; after generation Vitest passed.

## Rust schema changes

apps/api/src/openapi.rs remains sole schema source:

- DeletionRequest.password: password format and confirmation description.
- CreateTransactionRequest and UpdateTransactionRequest: replace writable occurred_at with
  optional occurred_local, exact YYYY-MM-DDTHH:mm pattern, and create/update omission semantics.
- TransactionContract: add required current wallet_name/category_name; mark canonical occurred_at
  read-only date-time.
- EntryDefaults: require response timezone alongside optional last-used wallet.
- UpdateWalletRequest: retain optional name/opening_balance, omit currency.
- ExpenseCategoryContract.share_percent: string, ^\d{1,3}\.\d{2}$, example 33.33, and exact
  0.00..100.00 description.
- History from/to and month descriptions/patterns are explicit.
- Recent transactions operation now accepts optional month=YYYY-MM, same selected local-month
  semantics as monthly and budget reporting.

## Generated diff review

Ran pnpm api:generate, git status --short, and git diff -- openapi/cashmemo-v1.json
apps/web/generated/api. Reviewed full generated tree. Expected changes:

- OpenAPI schemas and operation parameters reflect every Rust change.
- Orval models replace occurred_at request fields with occurred_local.
- Orval adds required response names/timezone and share_percent.
- Orval adds GetRecentTransactionsParams and propagates month through recent query/client
  signatures and query keys.
- Orval adds date/month descriptions and patterns to corresponding generated parameter models.

No generated file was edited manually. git diff --check passed.

## Exact staged allowlist

After generation, intended tracked paths were staged:

    apps/api/src/openapi.rs
    apps/api/tests/openapi.rs
    openapi/cashmemo-v1.json
    apps/web/generated/api
    apps/web/tests/api-client.spec.ts
    docs/verification/v1-pr3-repair-evidence.md
    .superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-13-report.md

Only generated JSON and apps/web/generated/api/** paths changed outside Rust source/tests/docs.
.serena/ stayed unstaged.

## Second-generation drift proof

After staging, reran pnpm api:generate. Required full-tree proof:

    git diff --exit-code
    git status --short
    git diff --cached --name-only

git diff --exit-code was clean across tracked working tree after generation. Cached names matched
allowlist above; only untracked .serena/ remained outside it.

## API/client tests

Passed:

    cargo test -p cashmemo-api --test openapi
    5 passed; 0 failed

    pnpm exec vitest run apps/web/tests/api-client.spec.ts
    2 passed; 0 failed

cargo fmt --all -- --check and git diff --check passed.

Repository-wide web typecheck is intentionally not green until next UI rebuild: existing dashboard
usage still passes hook options in old position after recent-month query generation, and existing
transaction fixtures omit newly required current names. These are expected consumers of frozen
contract, not contract-generation failures; no UI changes were made in Task 13.

## Contradiction evidence

No approved repair semantics were contradicted. Existing stale UI consumers exposed expected compile
fallout from frozen DTO/query changes. No test expectation was weakened, deleted, or changed outside
new API-client contract assertions.

## Self-review and concerns

- Rust source owns all schema changes; JSON and TypeScript output are deterministic generated
  artifacts.
- Request writes cannot use canonical occurred_at; response canonical instant is read-only.
- share_percent remains exact string with two-decimal/range documentation; no floating-point
  contract introduced.
- Recent-month filter is present in operation, generated params, query key, and client call.
- Current wallet/category names are required response fields, matching service output.
- Existing UI typecheck failures require Task 14+ consumer rebuild and are intentionally left for
  later work.
- Local mise pnpm asset installation remains unavailable on macOS; pinned Node plus exact existing
  pnpm passed toolchain:check.
