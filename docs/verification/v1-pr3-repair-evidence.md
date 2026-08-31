# Cashmemo V1 PR3 repair evidence

## Task 25 final evidence — implementation head `76a8a53`

Current head `76a8a53`, parent `3291391`; parent full matrix passed install/verify `181/181`,
operations `2/2`, Bats `44/44`, migrations `9/9`, S3 replay `8/8`, release build, audit, API direct
Trivy `0`, and web runtime contract. Head is config-only Playwright serialization: controlled
four-worker run `9/15` and two-worker run `14/15` showed deterministic resource contention; exact
default command with `workers: 1` passed `15/15` twice. Lint, typecheck, and `git diff --check`
passed. No timeout, retry, or product changes were made.

Scoped Cargo cleanup removed `19.3 GiB` generated `target` output to resolve `ENOSPC`; no source or
user data was removed. Direct local web-image Trivy remains **NOT GREEN** because Docker `29.5.2`
containerd exporter emits incomplete archive before verdict. Flattened merged-rootfs scan returned
`0` under unchanged `CRITICAL,HIGH`, `--ignore-unfixed`, `os,library` policy, diagnostic only;
hosted direct web-image Trivy remains mandatory.

Repository ruling: **REQUEST CHANGES / NOT MERGE READY** pending Task 26 hosted CI/direct scan and
exact main-integration review. Production remains **NOT READY**; no production evidence or action.
Earlier failures below remain superseded diagnostics, not current blockers except direct Trivy.

## Task 25 final fresh verification at `32913913267ec7ad8fd414dae2bd4f411f0778e7`

Recorded: `2026-08-31T12:34:00+0700` to `2026-08-31T12:57:16+0700 WIB` (`Asia/Jakarta`). This
section is current Task 25 evidence and supersedes prior Task 25 summaries below without removing
their failed-run history. Status: **BLOCKED**; no signed docs evidence commit was created.

| Gate | Fresh result |
| --- | --- |
| Baseline / pinned tools / frozen install | PASS: scoped `git diff --check`; Node `24.14.0`, pnpm `11.13.1`, Rust/Cargo `1.97.1`; `pnpm install --frozen-lockfile`. |
| `pnpm verify` | First exact attempt: FAIL, two 5-second Vitest timeouts (`179/181`); serial diagnostic of both files: PASS `21/21`; second exact attempt: PASS, `181/181`, plus OpenAPI/Orval drift, fmt, Clippy, Rust tests, lint, typecheck, and production build. |
| `pnpm test:operations` / Bats | PASS: `2/2` and `44/44`. |
| Default Playwright | First clean four-worker run: FAIL `13/15`, `budgets-recurring` and `cache-isolation` timed out at 60 seconds. Required clean `--workers=1` diagnostic: PASS `15/15`. Final clean four-worker retry: BLOCKED before tests by `ENOSPC: no space left on device` writing `.next/required-server-files.json`; host had `740 MiB` available. |
| Migration / receipt replay / release feature build | PASS: migrations `9/9`; isolated restored PostgreSQL + MinIO replay `8/8`; `cargo build --locked --release -p cashmemo-api --features s3-receipts` passed (feature build emitted one unused-import warning). Exact receipt environment: `DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:55429/cashmemo_e2e`, restored URL on `55430`, MinIO `http://127.0.0.1:32769`, bucket `cashmemo-v1-repair-task25`, test credentials from Task 25 brief. |
| Dependency audit / API image | PASS: `pnpm --dir apps/web audit --prod --audit-level high` found no known vulnerabilities; `cashmemo-v1-api:task25` = `sha256:bab4747e6e31ccaa63e5709f779bf3c409a33853fc5d8e70fa87ce639616adc2`; direct exact-policy Trivy found `0`. |
| Web image / runtime | PASS: `cashmemo-v1-web:task25` = `sha256:9d0ba778fa8bb946508b8363e8bb04f9c1483666b85890b4aee6289e092314ec`; runtime contract proved non-root response `200`, Node `v24.14.0`, and absent npm/npx/Corepack. |
| Direct web Trivy | **NOT GREEN / FAIL-CLOSED.** Exact required command exited `1` before a vulnerability verdict: missing archive blob `f9be01e39433b9e8b3a23690f760b5a8f7056934b6857841c2a7d8c27ffa5e29`. |
| Flattened web diagnostic | Diagnostic only: `cashmemo-v1-web:task25-flattened-export` = `sha256:abbc5675cf5503836109406cc6cdd52fdcac84da3e501ac7567bd2b9cd023fe4`; unchanged exact Trivy policy reached `0` Debian and Node-package findings. It cannot replace direct-tag scan. |
| Cleanup | PASS: only named `cashmemo-pr3-task25` and repository default `v1` disposable projects were downed; both final `ps -a` outputs were header-only. |

No production, Dokploy, registry, backup, restore-target, cutover, rollback, or external state was
accessed or changed. Protected modified `.claude/settings.json` and untracked `.serena/`,
`AGENTS.md`, and `CLAUDE.md` were untouched. Task 26 must provide hosted direct web-image Trivy on
the exact final integration result; available disk capacity must also be restored before a clean
default four-worker E2E verdict can be claimed.

## Task 25 fresh local verification rerun

Recorded: `2026-08-30T02:56:18+0700 WIB` (`Asia/Jakarta`, WIB).

Implementation under test: `d733b13dd7fd` on `rewrite/cashmemo-v1`.

Protected user-owned paths preserved throughout rerun:

- Modified tracked path: `.claude/settings.json`.
- Untracked paths: `.serena/`, `AGENTS.md`, `CLAUDE.md`.

Pinned local toolchain and scanner versions used for the fresh rerun:

- Node `24.14.0`
- pnpm `11.13.1`
- Cargo `1.97.1`
- Rust `1.97.1`
- Docker `29.7.1`
- Docker Compose `5.3.1`
- Trivy `0.74.0` with DB `UpdatedAt: 2026-08-27 02:16:59 +0000 UTC`
- Bats `1.14.0`

Disposable environment facts:

- Named feature/replay project: `cashmemo-pr3-task25`
- Dedicated ports: PostgreSQL `55429`, restored PostgreSQL `55430`, SMTP `55125`, Mailpit `58025`
- Disposable MinIO endpoint mapping: first run `127.0.0.1:32768`, fresh feature-gate rerun `127.0.0.1:32769`
- Exact S3 test env: bucket `cashmemo-v1-repair-task25`, access key `deletion-receipt-test`

Fresh command evidence:

| Gate | Command | Fresh window | Result |
| --- | --- | --- | --- |
| Baseline whitespace | `git diff --check` | `2026-08-30T02:24:45+0700` | PASS |
| Toolchain pin | `pnpm toolchain:check` | `2026-08-30T02:24:46+0700` to `02:24:47+0700` | PASS |
| Frozen install | `pnpm install --frozen-lockfile` | `2026-08-30T02:24:50+0700` to `02:24:51+0700` | PASS |
| Root composite gate | `pnpm verify` | `2026-08-30T02:24:51+0700` to `02:28:05+0700` | PASS. OpenAPI/Orval drift, `cargo fmt --check`, Clippy `-D warnings`, `cargo test -p cashmemo-api`, web lint, typecheck, Vitest `181/181`, and Next production build all passed. |
| CI contract gate | `pnpm test:operations` | `2026-08-30T02:28:05+0700` to `02:28:07+0700` | PASS. Vitest `2/2`. |
| Browser gate | `pnpm --dir apps/web exec playwright test` | `2026-08-30T02:31:02+0700` to `02:33:57+0700` | FAIL. `10` passed, `5` failed. |
| Repository + operations Bats | `bats tests/operations/*.bats tests/repository/*.bats` | `2026-08-30T02:35:16+0700` to `02:36:19+0700` | PASS. `44/44`. |
| Migration gate | `cargo test --locked -p cashmemo-api --test migrations` | `2026-08-30T02:36:22+0700` to `02:36:23+0700` | PASS. `9/9`. |
| Feature-enabled replay gate | `DATABASE_URL="$TEST_RESTORED_DATABASE_URL" cargo test --locked -p cashmemo-api --features s3-receipts --test deletion_receipt_replay` | `2026-08-30T02:36:23+0700` to `02:37:42+0700` | PASS. `8/8`. |
| Feature build gate | `cargo build --locked --release -p cashmemo-api --features s3-receipts` | `2026-08-30T02:37:42+0700` to `02:40:59+0700` | PASS |
| Dependency audit | `pnpm --dir apps/web audit --prod --audit-level high` | `2026-08-30T02:40:59+0700` to `02:41:00+0700` | PASS. `No known vulnerabilities found`. |
| API image build | `docker build --file infra/v1/api.Dockerfile --tag cashmemo-v1-api:task25 .` | `2026-08-30T02:41:00+0700` to `02:52:26+0700` | PASS |
| API image scan | `trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 --pkg-types os,library cashmemo-v1-api:task25` | `2026-08-30T02:52:26+0700` to `02:52:58+0700` | PASS. Debian `12.15`, vulnerabilities `0`. |
| Web image build | `docker build --file infra/v1/web.Dockerfile --tag cashmemo-v1-web:task25 .` | `2026-08-30T02:52:58+0700` to `02:56:14+0700` | PASS |
| Web runtime contract | `bash infra/v1/test-web-image.sh cashmemo-v1-web:task25` | `2026-08-30T02:56:14+0700` to `02:56:16+0700` | PASS. Non-root runtime, `node` present, `npm`/`npx`/`corepack` absent, `GET /` returned success after redirects. |
| Web image scan | `trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 --pkg-types os,library cashmemo-v1-web:task25` | `2026-08-30T02:56:16+0700` to `02:56:17+0700` | FAIL. Scanner aborted while reading tar layer; no vulnerability report produced. |
| Final whitespace | `git diff --check` | `2026-08-30T02:57:16+0700` | PASS |

Observed retries and diagnoses:

- Initial harness wrapper used nested `bash -lc`, which reset `PATH` to shell-default Node `22.19.0`. That made the first `pnpm toolchain:check` fail. Re-running the exact task with a non-login shell and the pinned Node `24.14.0`/Rust `1.97.1` paths passed. This was an invocation error, not a repository failure.
- First Playwright attempt failed immediately because the prestarted named project already held `127.0.0.1:55429`, while Playwright's `config.webServer` tried to start its own default `v1` PostgreSQL container on the same bound port.
- Second Playwright attempt failed before test execution with `pool timed out while waiting for an open connection`.
- A direct clean repro after `docker-compose -f infra/v1/test-compose.yml down --volumes --remove-orphans` proved the API migrate path itself still worked: `cargo run -p cashmemo-api --bin cashmemo-api -- migrate` returned `{"command":"migrate","processed":1}` with the exact E2E API environment.
- Third Playwright attempt on a clean default `v1` compose project produced the real remaining failures below.

Current failing Playwright evidence:

- `e2e/accessibility.spec.ts`: authenticated accessibility flow hit `locator.scrollIntoViewIfNeeded: Element is not attached to the DOM` after navigation reached the budgets view instead of the expected stable focused control.
- `e2e/auth-onboarding.spec.ts`: expected `USD · Balance 1000.00`, but rendered wallet summary was `USD 1,000.00 · USD` plus `Active · Opening balance 1000.00`.
- `e2e/transactions.spec.ts`: expected heading text like `Expense 12.34 USD`, but rendered transaction rows exposed amount text inside article links rather than heading nodes.
- `e2e/wallets-categories.spec.ts` budget creation flow never exposed a `Food & Drink` `<option>` in the budget category control on the captured page.
- `e2e/wallets-categories.spec.ts` category-management flow created `Temporary category`, but no `role="status"` node containing `Category created` appeared before timeout.

Image evidence:

- API image: `sha256:bab4747e6e31ccaa63e5709f779bf3c409a33853fc5d8e70fa87ce639616adc2`
- API local repo digest fallback: `cashmemo-v1-api@sha256:bab4747e6e31ccaa63e5709f779bf3c409a33853fc5d8e70fa87ce639616adc2`
- Web image: `sha256:7bbc0c6d17a2c798ddbd7d74996b855ba521d7de6afcd0f6b3053a7b954c7d5e`
- Web local repo digest fallback: `cashmemo-v1-web@sha256:7bbc0c6d17a2c798ddbd7d74996b855ba521d7de6afcd0f6b3053a7b954c7d5e`

Trivy web failure details:

- Command failed before vulnerability evaluation with `failed analysis ... file blobs/sha256/79348ece77876bf1b4e483da2ef9a4d68d8efadbc284558497fbe72698b2e388 not found in tar`.
- This is scanner/runtime evidence only. It is not proof that the image is clean or vulnerable.

Cleanup evidence:

- `docker-compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml down --volumes --remove-orphans` ran before the fresh named rerun and again at the end.
- `docker-compose -f infra/v1/test-compose.yml down --volumes --remove-orphans` removed the default disposable `v1` Playwright harness project after diagnostics.
- Final `docker-compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml ps -a` returned only the header row, proving no named Task 25 containers remained.

Limits:

- Local disposable PostgreSQL, Mailpit, and MinIO evidence proves repository mechanism only.
- No production backup, receipt store, restore rehearsal, deployment, cutover, rollback, or Dokploy mutation occurred.
- Production backup/store/restore/deploy/cutover remain **NOT READY** even where local replay and image/runtime checks passed.

## Task 13 OpenAPI/Orval contract freeze

- Rust-owned OpenAPI now freezes password-confirmed deletion/cancellation, strict occurred_local
  minute writes with omission semantics, canonical read-only UTC occurred_at, inclusive local
  history dates, entry-default timezone, editable opening balance without currency, current
  wallet/category names, exact two-decimal share_percent, and selected recent month.
- RED contract assertion initially failed because repaired fields/descriptions were absent. Rust
  schema assertions then passed 5/5; Orval regenerated the OpenAPI JSON and TypeScript client.
- Generated diff review found only expected contract surfaces plus Orval's query-param propagation
  for month/date filters. No generated file was manually edited.

## Account deletion password confirmation

- `cancellation_requires_password_then_revokes_restricted_session_and_clears_cookie` proves a
  deletion-only session cannot cancel with a wrong password; successful cancellation revokes that
  session, expires its cookie, and a new login receives `Full` access.
- `request_rejects_status_changed_after_password_verification_without_full_session` and
  `cancellation_rejects_hash_changed_after_password_verification_without_full_session` pause
  after Argon2 verification. A second PostgreSQL connection changes the user record before the
  transition lock; each transition rejects stale confirmation, preserves the externally changed
  state, and leaves no full-access session.
- `account_deletion_request_clears_session_cookie` proves successful deletion request expires the
  browser session cookie and revokes its token.

## Corrected baseline assertion

- Previous expectation: `concurrent_login_and_deletion_leave_no_live_full_session` required zero
  non-revoked sessions.
- Approved contradiction: when deletion wins the row lock, a concurrent login may legitimately
  create one `DeletionOnly` session.
- Corrected expectation: no surviving session may have `SessionAccess::Full`; a surviving
  `DeletionOnly` session is permitted.
- Protected regression: the race test obtains any concurrent login session and asserts its access
  is not `Full`.

## Verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test account_deletion --test auth --test ownership`

Result: 29 tests passed.

## Transaction local-time write contract

- `manual_local_times_use_stored_timezone_and_reject_invalid_inputs` proves Jakarta
  `2026-08-31T23:30` stores as `2026-08-31T16:30:00+00:00`; New York's ambiguous
  `2026-11-01T01:30` chooses earlier `2026-11-01T05:30:00+00:00`; nonexistent,
  seconds, offset, `Z`, and impossible inputs return `422`.
- Same test proves omitted create uses server `Utc::now()` and omitted update preserves exact
  stored instant.
- `entry_defaults_select_only_most_recent_active_wallet_for_authenticated_user` asserts exact
  defaults shape: `last_used_wallet_id` plus stored IANA `timezone`, with no server local time.

## Transaction time verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test transactions --test ownership`

Result: 13 tests passed.

## Local-calendar history and reporting contract

- History accepts exact `YYYY-MM-DD` `from` and `to` values as inclusive user-local dates, then
  applies half-open UTC bounds. Jakarta boundary fixtures prove inclusion at local midnight and
  exclusion at next-day midnight; Pacific/Apia's skipped 2011-12-30 resolves to an empty range.
- History and recent transaction reads return current wallet and category names while retaining
  user-scoped joins and stable cursor ordering.
- Monthly summary, selected-month recent transactions, and budget summary share local-calendar
  month boundaries. Reports exclude future transactions.
- Expense-category shares use decimal division, midpoint-away-from-zero rounding, clamping to
  `0.00..100.00`, and an exact two-decimal string representation.

## Local-calendar verification

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test history -- --nocapture`

Result: 6 tests passed.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test reporting -- --nocapture`

Result: 5 tests passed.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test history --test reporting --test budgets`

Result: 16 tests passed.

## Recurrence calendar-anchor resume contract

- Root cause: resume used mutable, clamped `next_due_date` as recurrence origin. A monthly
  Jan-31 rule parked at Feb-29 resumed on Aug-29 instead of Aug-31.
- `first_due_on_or_after` now uses direct daily, weekly, monthly, and yearly arithmetic from
  immutable `start_date`; monthly/yearly candidates clamp only final candidate date.
- `resume_uses_start_date_anchor_after_clamp_without_backfill_or_duplicates` covers a long-paused
  Jan-31 rule with Feb-29 scheduler state, confirms no pause backfill, one resumed occurrence,
  and no duplicate after a second processor run.
- `first_due_on_or_after_jumps_from_immutable_calendar_anchor` covers Jan-31, Jan-30, Feb-29,
  and weekly weekday anchors.

## Recurrence verification

RED:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test recurring -- --nocapture`

Result: expected failure in `resume_uses_start_date_anchor_after_clamp_without_backfill_or_duplicates`:
returned `2026-08-29`; expected `2026-08-31`.

GREEN, repeated for idempotency:

`for run in 1 2 3; do DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test recurring || exit 1; done`

Result: each run passed, 13 tests total.

## Editable wallet opening balance and durable onboarding completion

- Root cause: wallet PATCH exposed only `name`, while migration `0005` installed a trigger that
  rejected every opening-balance change. Onboarding completion was recomputed from complete
  starter categories plus an active wallet, so archived-only accounts could reopen onboarding and
  already-completed accounts did not repair missing starter categories.
- Baseline correction: `updates_name_but_rejects_immutable_currency_and_opening_balance` and
  `rejects_direct_wallet_currency_and_opening_balance_changes` encoded opening-balance
  immutability. Approved repair design section 9 instead requires optional wallet `name` and
  `opening_balance` updates while currency remains immutable. Corrected tests allow exact opening
  balance changes, retain currency rejection, and protect cross-user wallet ownership.
- `0009_wallet_onboarding_repair.sql` additively removes both the obsolete trigger and function,
  adds `users.onboarding_completed_at`, and backfills the same migration timestamp for qualifying
  users with active or archived wallets. A user without any wallet remains incomplete.
- Wallet update locks the owned wallet, reads its currency exponent from the registry, validates
  exact nonnegative decimal input, and updates only supplied wallet fields. The regression proves
  current balance changes while transaction count, monthly report, and budget summary stay exact.
- Onboarding reconciliation seeds every missing normalized starter category once, preserves an
  existing completion timestamp, sets first-wallet completion once, and treats archived-only
  completed accounts as onboarded. Repeated reads create no duplicate starters; no seed version or
  state machine was added.

### Wallet/onboarding verification

RED evidence:

- Required combined RED stopped in migrations because version 9 and
  `onboarding_completed_at` were absent.
- `updates_name_and_opening_balance_without_changing_financial_activity` returned `422`; expected
  `200`.
- `rejects_empty_currency_negative_and_excess_scale_wallet_updates` failed because
  `opening_balance` was an unknown PATCH field instead of a field-level validation path.
- Onboarding reconciliation tests failed because `onboarding_completed_at` did not exist and the
  qualifying derived state returned `categories_seeded: false`.
- Obsolete ownership baseline failed at `wallet opening balance must be immutable` after migration
  0009, proving the exact approved-design contradiction before correction.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test migrations -- --nocapture`

Result: 9 tests passed, including version-9 checksum identity, trigger/function removal, and
active/archived-wallet backfill.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test ownership -- --nocapture`

Result: 7 tests passed, including currency immutability, editable opening balance, and cross-user
ownership constraints.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test wallets --test onboarding --test migrations --test reporting --test transactions`

Result: 38 tests passed: migrations 9, onboarding 7, reporting 5, transactions 6, wallets 11.

## Deletion-receipt key-version binding

- Root cause: replay verified that a receipt's declared `key_version` existed, but then compared
  its HMAC against every configured key. A canonical v1 receipt carrying a v2 HMAC could therefore
  delete the matching restored user.
- Replay now performs exact `key_for_version(keyring, receipt.key_version)` lookup and verifies
  only that declared-key HMAC with `Mac::verify_slice`. Canonical body, object-key, and
  known-version validation still finish before restored-database matching and transactional
  deletion.
- Real S3-compatible integration coverage proves valid v1/v1 and v2/v2 replay, declared v1 with a
  v2 HMAC failing closed, unknown version failing closed, malformed body and object key failing
  closed, and a second replay deleting nothing.
- Existing S3 receipt tests retain immutable PUT retry/idempotency and divergent-object behavior.

### Deletion-receipt verification

Local Docker CLI had no Compose plugin, so the specified commands used installed
`docker-compose` 5.3.1 with dedicated project `cashmemo-pr3-task6`. Only `restored-postgres` and
`deletion-receipts` started: PostgreSQL at `127.0.0.1:56430`, MinIO at
`127.0.0.1:32774`.

RED:

`cargo test -p cashmemo-api --features s3-receipts --test deletion_receipt_replay -- --nocapture`

Result: expected failure in `declared_v1_receipt_with_v2_hmac_never_purges`: `users_purged` was
`1`; expected `0`. Other 6 replay tests passed.

GREEN:

`cargo test -p cashmemo-api --test deletion_receipt_replay --test deletion_receipts --features s3-receipts`

Result: replay 7 tests passed; S3 receipt PUT/retry suite 3 tests passed.

Cleanup: `docker-compose -p cashmemo-pr3-task6 -f infra/v1/test-compose.yml down --volumes --remove-orphans`
removed both containers and the named network. Follow-up project `ps -a` returned an empty table.

### Round 1 constant-time verification repair

- Root cause: exact key-version binding still derived an ordinary `[u8; 32]` candidate and used
  array `==`, whose comparison was not the required constant-time MAC verification primitive.
- Focused RED added fixed HMAC vectors for correct declared key, modified tag, and a v2 tag checked
  under declared v1 key. It failed to compile because minimal `verify_user_id_hmac` did not exist.
- Focused GREEN: 3 verifier unit tests passed. Production resolves exact declared key first, then
  constructs `Hmac<Sha256>` and calls `Mac::verify_slice`; it no longer materializes or compares a
  candidate tag.
- `delete_failure_rolls_back_earlier_replay_deletions` uses two deterministic matched users and
  valid recurring data whose immutable occurrence blocks second cascade. Replay rolls back first
  deletion, reports zero purged and two unprocessed, and preserves both users.
- Fresh `cashmemo-pr3-task6` integration run used PostgreSQL `127.0.0.1:56430` and MinIO
  `127.0.0.1:32776`: account deletion 11 passed, replay 8 passed, receipt PUT/retry 3 passed.
  Concrete S3 receipt success followed by database final-delete failure and identical retry passed.
- Final named-project cleanup removed both containers and network; follow-up project `ps -a`
  returned an empty table.

## Trusted-proxy-aware auth throttling

- Root cause: auth limiter keyed only the Axum TCP `ConnectInfo<SocketAddr>`. Behind Traefik that
  address is the shared proxy peer, so distinct public clients consumed one IP bucket. Trust was
  neither configurable nor transferred through a bounded, authenticated proxy suffix.
- `CASHMEMO_V1_TRUSTED_PROXY_CIDRS` is parsed as comma-separated CIDRs during `serve` startup.
  Empty trusts nobody; malformed input stops startup. V1 retains one API replica and its bounded
  in-memory limiter. No Redis or persistent attempt history was added.
- Direct untrusted peers remain authoritative and all supplied `X-Forwarded-For` values are
  ignored. A trusted direct peer activates a right-to-left scan that strips configured trusted
  proxies and returns the first untrusted IP literal. It examines no more than 8192 total header
  bytes, the rightmost 2048 bytes, and 16 hops. Once a client is established, hostile left-prefix
  values are not parsed.
- Trusted forwarding with a missing, malformed, all-trusted, overlong, or over-hop suffix returns
  `400 INVALID_FORWARDING_METADATA` before identifier parsing, limiter mutation, or auth-handler
  execution. A trusted address left of an already-established untrusted client grants nothing.
- HTTP middleware tests inject real `ConnectInfo` extensions. They prove direct spoof resistance,
  trusted-suffix stripping, two clients behind one proxy using distinct buckets, hostile-left
  early stop, internal trusted-address non-escalation, and pre-handler rejection.
- `main.rs` already served the router through
  `into_make_service_with_connect_info::<SocketAddr>()`; the repair retains that required peer
  propagation. The operations suite exercises the real TCP server path.

### Trusted-proxy RED/GREEN evidence

Initial RED:

`cargo test -p cashmemo-api --test http_safety -- --nocapture`

Result: compile failed because `TrustedProxyConfig` and the trusted-proxy-aware limiter constructor
did not exist. A direct-peer-only mutation reproducing the baseline then ran
`two_clients_behind_one_trusted_proxy_keep_distinct_ip_buckets`: client `203.0.113.9` received
`429`, expected `401`, proving both clients shared the Traefik peer bucket.

Header-bound mutation RED: removing the 8192-byte check let an oversized hostile left prefix with
a valid rightmost client reach the handler (`401`, expected pre-handler `400`). Restoring the check
made that HTTP test pass.

Compose RED:

`bash infra/v1/test-dokploy-compose.sh`

Result: three expected failures: missing required API trusted-proxy CIDRs, missing rendered API
CIDRs, and missing explicit Traefik safe-append/header-limit contract.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57429/cashmemo_e2e cargo test -p cashmemo-api --test http_safety --test operations`

Result: 19 tests passed (`http_safety` 12, `operations` 7).

`bash infra/v1/test-dokploy-compose.sh`

Result: `Compose contract PASS`.

Traefik is external to this Compose project. `x-traefik-static-arguments` records exact Dokploy
operator configuration: `insecure=false`, safe append via `notAppendXForwardedFor=false`, optional
exact upstream `trustedIPs`, and `http.maxHeaderBytes=8192`. The Compose contract asserts all four
arguments and the API CIDRs. Actual managed-Traefik config and public two-client probes remain a
pre-route-activation operational gate; this task made no Dokploy or production mutation.

## Exact monetary output invariant

- Root cause: wallet, transaction, budget, and reporting services each formatted persisted
  `Decimal` values independently; authoritative paths used `round_dp` or equivalent rendering,
  silently changing a corrupt-scale value such as `1.231` for a two-decimal currency into `1.23`.
- `format_exact_for_exponent` normalizes trailing zeroes, rejects normalized scale above the
  currency exponent with `MoneyError::ExcessScale`, and only then pads/rescales output. Negative
  net values remain exact. `format_percentage_2dp` is separate and explicitly uses
  `MidpointAwayFromZero` for presentation-only share/progress values.
- Corrupt persisted-row regressions cover wallet list, budget list, and monthly reporting; each
  expects an internal error rather than a rounded successful response. Existing reporting and
  budget assertions continue to require two-decimal percentage strings.

### Exact-money verification

RED:

`cargo test -p cashmemo-api --test money -- --nocapture`

Result: compile failed as expected because `format_exact_for_exponent` and
`format_percentage_2dp` did not yet exist. Initial combined endpoint RED also reached compilation,
then DB-backed execution was unavailable because `DATABASE_URL` was unset (`DATABASE_URL must be
set`).

GREEN:

`cargo fmt --all -- --check && cargo test -p cashmemo-api --lib`

Result: formatting passed; 8 library tests passed.

`cargo test -p cashmemo-api --test money exact_formatter -- --nocapture`

Result: 3 exact formatter tests passed (11 filtered).

`cargo test -p cashmemo-api --test wallets --test budgets --test reporting --no-run`

Result: all three DB-backed targets compiled.

Required DB-backed command was rerun:

`cargo test -p cashmemo-api --test money --test wallets --test budgets --test reporting -- --nocapture`

Result: compilation succeeded; execution is blocked in this workspace because `DATABASE_URL` is
unset. No database was started or mutated by this task.

## Read-only schema-aware readiness

- Root cause: `/api/v1/health/ready` issued only `SELECT 1`, so an empty database, a stale V1
  migration prefix, failed migration, divergent migration checksum, and unknown non-empty database
  all incorrectly returned `200`.
- `check_latest_v1_readiness` now calls the existing V1 target guard only. It verifies expected
  table set, `cashmemo`/`v1` identity, and successful checksummed migrations 1 through 9 with
  SELECT queries; it never initializes metadata, obtains advisory locks, runs migrations, or
  repairs state.
- Readiness tests snapshot public tables, public column schema, and `_sqlx_migrations` version,
  success, and checksum before and after each request. Exact current V1 alone returns `200`; empty,
  stale-prefix, failed, checksum-divergent, and unknown non-empty states return canonical `503`
  responses with preserved request ID. Liveness remains `200` without database connectivity.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57432/cashmemo_e2e cargo test -p cashmemo-api --test operations --test migrations --test http_safety`

Result: 34 tests passed (`http_safety` 12, `migrations` 9, `operations` 13).

## Canonical request IDs and safe request logs

- Root cause: restricted `GET /sessions/current` and `POST /sessions/revoke-all` minted fresh
  `RequestId`s for errors, while the auth extractor and origin/rate-limit middleware could also
  fall back to fresh IDs. Error envelopes could therefore disagree with the response header for
  one request. Request logs emitted only request ID, status, and latency.
- Request-ID attachment remains the outermost app middleware. Incoming IDs must be canonical UUIDs
  of the exact accepted size; malformed values receive a generated canonical UUID. Auth routes,
  extractor, origin policy, rate limiter, and request logger now require and reuse that attachment.
- Structured `http_request` records contain only `request_id`, `method`, matched route template
  (or literal `<unmatched>`), `status`, `latency_ms`, `service`, and `version`, plus the event
  discriminator. URI and query strings are never logged.

### Canonical ID/log RED/GREEN evidence

RED:

- Restricted current-session request returned body request ID
  `0fda5273-1b1f-4aeb-a417-a3e1b069d966`, not incoming
  `cbca2e85-4d7c-4ce6-9a8c-69f7e647905b`.
- Structured log test contained only `event`, `latency_ms`, `request_id`, and `status`; required
  method, route, service, and version were absent.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57433/cashmemo_e2e cargo test -p cashmemo-api --test http_safety --test operations --test auth -- --test-threads=1`

Result: 41 tests passed (`auth` 15, `http_safety` 13, `operations` 13). Serial test threads avoid
SQLx temporary-database cleanup collisions observed when these database-backed tests run in
parallel.

Log privacy evidence: real TCP matched and hostile unmatched requests carried password, token,
note, and amount values in body/query. Captured JSON logs assert matched route
`/api/v1/health/live`, unmatched route `<unmatched>`, and absence of every raw query/path prefix
and secret value.

### Canonical ID/log Round 1: auth JSON rejections

- Root cause: each auth JSON body was a bare Axum `Json<T>` extractor. Malformed JSON and
  missing/wrong `Content-Type` rejected before route handlers could reuse attached request ID,
  returning Axum framework `400`/`415` bodies while outer middleware attached a canonical header.
- Every auth JSON route now receives `Result<Json<T>, JsonRejection>` and passes it through one
  reusable mapper. Rejections return generic `422 VALIDATION_FAILED` envelope with attached
  request ID and empty fields; parser/content-type details and request body are discarded.
- Regression covers register, verify-email, verification-resend, login, reset-request, and
  reset-consume for malformed JSON, missing `Content-Type`, and wrong `Content-Type`. It asserts
  header/body UUID equality, canonical envelope, and absence of supplied email/password secrets.

GREEN:

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57433/cashmemo_e2e cargo test -p cashmemo-api --test http_safety --test operations --test auth -- --test-threads=1`

Result: 42 tests passed (`auth` 15, `http_safety` 14, `operations` 13).

## Portable recovery timestamps

- `scripts/operations/utc-timestamp.mjs` provides deterministic `--base <RFC3339>|--now
  --offset-seconds <signed integer>` output in exact UTC-seconds form.
- Explicit bases must match the strict UTC-seconds grammar and an exact `Date` ISO round-trip;
  impossible dates, milliseconds, offsets, malformed values, unsafe arithmetic, and Date-range
  overflow fail closed. `--now` truncates to UTC seconds for convenience only.
- Preservation and restore Bats fixtures derive all expiration, stale, and future values through
  the helper, removing BSD `date -v` dependencies. Recovery CI pins Node `24.14.0` through
  `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` before Bats.

### Portable timestamp verification

RED: `bats tests/operations/utc-timestamp.bats` failed because
`scripts/operations/utc-timestamp.mjs` was missing (`MODULE_NOT_FOUND`).

GREEN: `PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH bats
tests/operations/utc-timestamp.bats tests/operations/preservation-gate.bats
tests/operations/restore-drill.bats` passed 19 tests.

Full operations and repository verification:

`PATH=/Users/andresholivin/.local/share/mise/installs/node/24.14.0/bin:$PATH bats
tests/operations/*.bats tests/repository/*.bats`

Result: 44 tests passed. No existing test expectation was weakened or contradicted; only BSD
date fixture generation was replaced with equivalent helper calculations.

## Reproducible clean web runtime image

Task 12 implementation is recorded in `.superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-12-report.md`.
The runtime contract is now executed by the hosted `docker-images` web matrix entry before its
existing Trivy scan. Trivy policy remains `CRITICAL,HIGH`, `ignore-unfixed: true`, `exit-code: 1`,
and `vuln-type: os,library`.
