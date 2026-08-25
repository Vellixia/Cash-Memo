# Cashmemo V1 PR #3 Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair all confirmed PR #3 correctness/security/CI findings, rebuild the existing frontend
around current shadcn/Base UI and Tailwind, and produce exact-current-target merge-readiness
evidence without merging or touching production.

**Architecture:** Preserve the Next.js → generated REST client → Rust/Axum → PostgreSQL modular
monolith. Land ten independent backend TDD slices, fix CI blockers, freeze Rust/OpenAPI/Orval
contracts, establish one shadcn/Base UI design system, then migrate user flows slice by slice.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, shadcn/ui with Base UI,
Lucide, React Hook Form, Zod, TanStack Query, Axios, Orval, Rust 1.97.1, Axum, SQLx, PostgreSQL,
rust_decimal, Vitest, React Testing Library, Playwright, Bats, Docker, Trivy.

**Spec:** `docs/superpowers/specs/2026-08-25-cashmemo-v1-pr3-repair-design.md`

## Global Constraints

- Work only on `rewrite/cashmemo-v1`; never merge or force-push.
- No deployment, Dokploy mutation, production DB access/migration/routing, or destructive production
  action.
- Use RED → GREEN → REFACTOR for every behavior change; record every observed RED command/reason.
- Use real PostgreSQL tests for persistence, locks, migrations, ownership, and reporting.
- Do not edit generated Orval files manually.
- Do not alter existing committed migration bytes; add migration `0009`.
- Do not use JS `Number`/`parseFloat` for authoritative money.
- Do not trust forwarding headers from untrusted direct peers.
- Preserve authenticated `no-store` and private-cache clearing rules.
- Keep `.serena/` untouched.
- Each task ends with focused verification and one reviewable signed commit.
- Require repository-pinned Node `24.14.0`; run `pnpm toolchain:check` before execution. Local
  environment selects pinned Node normally; never hard-code a developer-machine Node path.

## Per-task Subagent Invariant

Before every task, fresh implementer must:

- [ ] Run `git branch --show-current` and verify exact branch `rewrite/cashmemo-v1`.
- [ ] Run `git log -1 --oneline` and verify previous task's signed commit is present.
- [ ] Run `git status --short`; require tracked tree clean. Report `.serena/` separately and never
      stage, edit, delete, or clean it.
- [ ] Read `docs/superpowers/specs/2026-08-25-cashmemo-v1-pr3-repair-design.md` and only current
      task section from this plan.
- [ ] Run `pnpm toolchain:check`; require Node `24.14.0`, pnpm `11.13.1`, Rust `1.97.1`.

After every task, implementer must:

- [ ] Run named focused RED/GREEN tests and named surrounding suite.
- [ ] Run `git diff --check` and review `git diff --stat` plus full task diff.
- [ ] Verify generated Orval files were changed only by `pnpm api:generate`, never manually.
- [ ] Create one signed commit using task's exact commit command.
- [ ] Run `git status --short`; require no tracked residue.
- [ ] Hand commit to fresh reviewer gate before Task N+1 begins.

## Test Environment

Focused PostgreSQL commands assume fresh disposable services:

```bash
docker compose -f infra/v1/test-compose.yml up -d postgres mailpit
export DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e
pnpm toolchain:check
```

Do not reuse production or legacy database targets.

---

### Task 1: Password-confirmed deletion cancellation and session revocation

**Files:**

- Modify: `apps/api/tests/account_deletion.rs`
- Modify: `apps/api/src/accounts/deletion.rs`
- Modify: `apps/api/src/accounts/routes.rs`
- Modify: `apps/api/src/auth/routes.rs`
- Create: `apps/api/src/auth/cookie.rs`
- Modify: `apps/api/src/auth/mod.rs`
- Modify: `apps/api/tests/auth.rs`
- Create: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Consumes: valid `AuthSession { access: DeletionOnly, user_id, session_id }`.
- Produces: `AccountDeletionService::cancel(user_id, password)` with password verification outside
  transaction; `clear_session_cookie()` shared response helper; cancellation request body
  `{ password: String }`.

- [ ] **Step 1: Write RED cancellation integration tests**

Add tests proving wrong password preserves `pending_deletion` and token; correct password revokes
token, clears cookie, requires fresh login, and fresh login is `Full`. Correct the race assertion to
allow deletion-only sessions while rejecting full access.

```rust
assert_eq!(cancel_wrong.status(), StatusCode::UNAUTHORIZED);
assert_eq!(auth.session(&restricted_token).await.unwrap().access, SessionAccess::DeletionOnly);
assert!(cancel_ok.headers()[SET_COOKIE].to_str().unwrap().contains("Max-Age=0"));
assert_eq!(auth.session(&restricted_token).await, Err(AuthError::Unauthorized));
assert_eq!(auth.login(email, password).await.unwrap().access, SessionAccess::Full);
```

- [ ] **Step 2: Write RED request/cancellation lock-window tests**

Add service test synchronization hook between Argon2 verification and transaction start. For both
`request()` and `cancel()`, change password hash or account status through second connection during
hook. Assert transition fails, old state remains, and no full session survives. Add request-success
cookie-clear assertion.

- [ ] **Step 3: Run RED tests**

```bash
cargo test -p cashmemo-api --test account_deletion --test auth -- --nocapture
```

Expected: cancellation body/cookie/revocation assertions fail; race test demonstrates prior
zero-session expectation is invalid under one ordering; request/cancel lock-window tests show hash
verification currently occurs inside transaction or stale verification is accepted.

- [ ] **Step 4: Extract pre-verification snapshot**

Add private snapshot type containing exact `password_hash` and `status`. Load it without row lock,
verify supplied password with Argon2id outside any PostgreSQL transaction, then pass verified
snapshot into transition function. Do this for both `request()` and `cancel()`.

- [ ] **Step 5: Implement lock-safe request and cancellation**

Load `(password_hash, status)` first, verify Argon2id outside transaction, then begin transaction
and lock:

```sql
SELECT password_hash, status::text
FROM users
WHERE id = $1
FOR UPDATE
```

Require locked hash/status equal verified snapshot. Request requires still `active`; cancellation
requires still `pending_deletion`. Mismatch returns re-authentication failure without transition.
Request marks pending and revokes all sessions; cancellation marks active and revokes all sessions;
both commit before response. Expose shared cookie expiry helper and return it from successful
request/cancel routes.

- [ ] **Step 6: Run focused GREEN tests**

```bash
cargo test -p cashmemo-api --test account_deletion -- --nocapture
```

- [ ] **Step 7: Run surrounding auth suite**

```bash
cargo test -p cashmemo-api --test account_deletion --test auth --test ownership
```

- [ ] **Step 8: Review diff and record corrected baseline expectation**

Record previous zero-session expectation, approved contradiction, corrected no-full-session
expectation, and protected regression in repair evidence.

- [ ] **Step 9: Commit slice**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: revoke restricted sessions on deletion cancel"
```

### Task 2: Local financial datetime write contract

**Files:**

- Modify: `apps/api/tests/transactions.rs`
- Modify: `apps/api/src/time.rs`
- Modify: `apps/api/src/transactions/routes.rs`
- Modify: `apps/api/src/transactions/service.rs`
- Modify: `apps/api/src/transactions/mod.rs`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces: `parse_local_minute("YYYY-MM-DDTHH:mm")`; `resolve_manual_local(Tz, NaiveDateTime)`;
  create/update `occurred_local`; entry defaults `{ last_used_wallet_id, timezone }`.
- Preserves: response `occurred_at` RFC3339 UTC only.

- [ ] **Step 1: Write RED parser/service tests**

Cover create with omitted `occurred_local` using server current instant; create with supplied
Jakarta local minute; ambiguous New York time choosing earlier instant; nonexistent time 422;
seconds/offset/Z rejection; omitted update preserving exact stored instant.

```rust
assert_eq!(created["occurred_at"], "2026-08-31T16:30:00+00:00");
assert_eq!(entry_defaults["timezone"], "Asia/Jakarta");
assert_eq!(nonexistent.status(), StatusCode::UNPROCESSABLE_ENTITY);
```

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test transactions -- --nocapture
```

Expected: old `occurred_at` write contract accepts UTC strings and lacks timezone defaults.

- [ ] **Step 3: Implement strict parser and resolver**

Parse exact 16-character local minute. Resolve `LocalResult::Single`, choose `min()` for Ambiguous,
and reject None. Load user timezone inside service transaction; never use browser/host timezone.

- [ ] **Step 4: Preserve create/update omission semantics**

Create DTO uses `occurred_local: Option<String>`: `None` assigns server `Utc::now()`; `Some` uses
strict resolver. Update `None` leaves stored `occurred_at` unchanged. Responses expose only
canonical UTC `occurred_at`.

- [ ] **Step 5: Run focused GREEN**

```bash
cargo test -p cashmemo-api --test transactions -- --nocapture
```

- [ ] **Step 6: Run ownership suite**

```bash
cargo test -p cashmemo-api --test transactions --test ownership
```

- [ ] **Step 7: Review diff, record gap, and commit**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: resolve transaction times in user timezone"
```

### Task 3: Semantic history dates and month-consistent reporting

**Files:**

- Modify: `apps/api/tests/history.rs`
- Modify: `apps/api/tests/reporting.rs`
- Modify: `apps/api/src/time.rs`
- Modify: `apps/api/src/transactions/query.rs`
- Modify: `apps/api/src/transactions/service.rs`
- Modify: `apps/api/src/reporting/query.rs`
- Modify: `apps/api/src/reporting/routes.rs`
- Modify: `apps/api/src/reporting/mod.rs`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces: inclusive `from`/`to` `NaiveDate` API; shared
  `first_valid_instant_at_or_after_midnight`; optional recent `month=YYYY-MM`; transaction read
  names; category `share_percent: String` scale 2.

- [ ] **Step 1: Write RED boundary/report tests**

Cover Jakarta local day half-open UTC bounds, a fully skipped calendar date, history/month
agreement, selected-month recent results, future exclusion, current wallet/category names, and exact
percentage.

```rust
assert_eq!(category["share_percent"], "33.33");
assert_eq!(item["wallet_name"], "Travel Cash");
assert_eq!(item["category_name"], "Dining");
```

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test history --test reporting -- --nocapture
```

- [ ] **Step 3: Implement shared local calendar boundaries**

Parse exact date-only query values. Resolve requested midnight to first valid instant at/after it;
resolve inclusive `to` by next calendar day start. Reuse helper for month range. Add skipped-date
unit tests.

- [ ] **Step 4: Apply boundaries to history query**

Replace client UTC instant filters with `from: Option<NaiveDate>`/`to: Option<NaiveDate>` and SQL
`occurred_at >= start`, `occurred_at < end`. Keep user scoping/cursor unchanged. Join current wallet
and category names.

- [ ] **Step 5: Run history-focused GREEN**

```bash
cargo test -p cashmemo-api --test history -- --nocapture
```

- [ ] **Step 6: Apply boundaries/read fields to reports**

Use same month helper for monthly/budget/recent. Add optional recent `month`; exclude future
entries. Compute `share_percent` using exact Decimal division, `MidpointAwayFromZero`, scale 2,
range `0.00..100.00`; return string.

- [ ] **Step 7: Run reporting-focused GREEN**

```bash
cargo test -p cashmemo-api --test reporting -- --nocapture
```

- [ ] **Step 8: Run combined history/report/budget suite**

```bash
cargo test -p cashmemo-api --test history --test reporting --test budgets
```

- [ ] **Step 9: Review boundary/read-contract diff and record gap**

- [ ] **Step 10: Commit slice**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: align history and reports to local calendar"
```

### Task 4: Recurrence resume anchor preservation

**Files:**

- Modify: `apps/api/tests/recurring.rs`
- Modify: `apps/api/src/recurring/service.rs`
- Modify: `apps/api/src/recurring/processor.rs`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces: arithmetic `first_due_on_or_after(start_date, target_date, cadence)` used by create,
  update, and resume; `next_due_date` remains scheduler state only.

- [ ] **Step 1: Write RED anchor tests**

Add Jan-31, Jan-30, Feb-29, weekly weekday, clamped pause/resume, long pause, no-backfill, and
no-duplicate occurrence assertions.

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test recurring -- --nocapture
```

Expected: resume derives from clamped `next_due_date` for at least monthly/yearly cases.

- [ ] **Step 3: Implement arithmetic anchor jumps**

Monthly/yearly calculation derives period index from year/month difference and clamps only candidate
date; weekly uses whole-week arithmetic from start weekday. Never loop daily over paused history.

- [ ] **Step 4: Run GREEN repeatedly for idempotency/concurrency**

```bash
for run in 1 2 3; do cargo test -p cashmemo-api --test recurring || exit 1; done
```

- [ ] **Step 5: Record gap and commit**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: preserve recurring calendar anchors on resume"
```

### Task 5: Editable opening balance and durable onboarding completion

**Files:**

- Create: `apps/api/migrations/0009_wallet_onboarding_repair.sql`
- Modify: `apps/api/tests/migrations.rs`
- Modify: `apps/api/tests/wallets.rs`
- Modify: `apps/api/tests/onboarding.rs`
- Modify: `apps/api/src/wallets/routes.rs`
- Modify: `apps/api/src/wallets/service.rs`
- Modify: `apps/api/src/onboarding/service.rs`
- Modify: `apps/api/src/onboarding/routes.rs`
- Modify: `apps/api/src/db/target_guard.rs`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces: update `{ name?: String, opening_balance?: String }`; durable
  `users.onboarding_completed_at`; latest migration set through version 9.

- [ ] **Step 1: Replace wrong wallet expectation with RED approved behavior**

Tests require exact opening-balance update, negative/excess-scale rejection, changed current
balance, and unchanged transaction/report/budget activity. Add archive-only-wallet onboarding
regression and migration backfill fixture for timezone + default currency + active/archived wallet.
Add existing completed-user fixture with missing/partial starter categories; assert reconciliation
creates each missing normalized category once, marks/keeps onboarding complete, and repeated calls
create no duplicates.

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test wallets --test onboarding --test migrations -- --nocapture
```

- [ ] **Step 3: Add additive migration 0009**

Migration performs:

```sql
DROP TRIGGER wallets_opening_balance_immutable ON wallets;
DROP FUNCTION reject_wallet_opening_balance_change();
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
UPDATE users u SET onboarding_completed_at = now()
WHERE u.timezone_configured_at IS NOT NULL
  AND u.default_currency_code IS NOT NULL
  AND EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id);
```

Update migration identity/checksum expectation to version 9. Run only migration test and confirm
trigger plus unused function are absent and qualifying existing users remain completed.

```bash
cargo test -p cashmemo-api --test migrations -- --nocapture
```

- [ ] **Step 4: Implement wallet update contract**

Route accepts optional `name` and `opening_balance`, rejects neither-present, and omits currency.
Service locks owned wallet, reads registry exponent, validates exact nonnegative string, then
updates provided fields. It creates no transaction and touches no monthly/budget data.

- [ ] **Step 5: Run wallet-focused GREEN tests**

```bash
cargo test -p cashmemo-api --test wallets -- --nocapture
```

- [ ] **Step 6: Reconcile onboarding completion and starter categories**

In onboarding service, run existing normalized insert-on-conflict seeding before returning completed
state for any account satisfying timezone + default currency + ever-created wallet. Do not add a
seed version/state machine. Set `onboarding_completed_at` once after qualifying first wallet.
Repeated onboarding reads/reconciliation must produce same category set.

- [ ] **Step 7: Run onboarding-focused GREEN**

```bash
cargo test -p cashmemo-api --test onboarding --test migrations -- --nocapture
```

- [ ] **Step 8: Run reporting/transaction suites**

```bash
cargo test -p cashmemo-api --test wallets --test onboarding --test migrations --test reporting --test transactions
```

- [ ] **Step 9: Review migration/service diff and record test correction**

Record removed immutability expectation, approved editable behavior, migration backfill, and
starter-category reconciliation evidence.

- [ ] **Step 10: Commit slice**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: restore editable wallet opening balances"
```

### Task 6: Deletion-receipt key-version binding

**Files:**

- Modify: `apps/api/tests/deletion_receipt_replay.rs`
- Modify: `apps/api/src/receipts/replay.rs`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces: exact `key_for_version(keyring, receipt.key_version)` lookup before HMAC comparison.

- [ ] **Step 1: Write RED replay tests**

Cover valid v1/v1, valid v2/v2, declared v1 with v2 HMAC, unknown version, malformed body/object
key, and second idempotent replay.

- [ ] **Step 2: Run RED**

```bash
docker compose -f infra/v1/test-compose.yml up -d --wait restored-postgres deletion-receipts
receipt_port="$(docker compose -f infra/v1/test-compose.yml port deletion-receipts 9000 | sed 's/.*://')"
export DATABASE_URL=postgres://cashmemo_restore_e2e:cashmemo_restore_e2e@127.0.0.1:54330/cashmemo_restore_e2e
export TEST_DELETION_RECEIPT_S3_ENDPOINT="http://127.0.0.1:${receipt_port}"
export TEST_DELETION_RECEIPT_S3_BUCKET=cashmemo-v1-repair-task6
export TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID=deletion-receipt-test
export TEST_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY=deletion-receipt-test-secret
cargo test -p cashmemo-api --features s3-receipts --test deletion_receipt_replay -- --nocapture
```

- [ ] **Step 3: Replace all-key search with exact lookup**

For each canonical receipt, resolve one key by declared version and compute only that candidate
HMAC. Keep canonical-body/object-key validation before matching and transactional deletion
afterward.

- [ ] **Step 4: Run GREEN plus S3 receipt tests**

```bash
receipt_port="$(docker compose -f infra/v1/test-compose.yml port deletion-receipts 9000 | sed 's/.*://')"
export DATABASE_URL=postgres://cashmemo_restore_e2e:cashmemo_restore_e2e@127.0.0.1:54330/cashmemo_restore_e2e
export TEST_DELETION_RECEIPT_S3_ENDPOINT="http://127.0.0.1:${receipt_port}"
export TEST_DELETION_RECEIPT_S3_BUCKET=cashmemo-v1-repair-task6
export TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID=deletion-receipt-test
export TEST_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY=deletion-receipt-test-secret
cargo test -p cashmemo-api --test deletion_receipt_replay --test deletion_receipts --features s3-receipts
```

- [ ] **Step 5: Clean exact disposable services**

```bash
docker compose -f infra/v1/test-compose.yml stop restored-postgres deletion-receipts
docker compose -f infra/v1/test-compose.yml rm -f restored-postgres deletion-receipts
unset DATABASE_URL TEST_DELETION_RECEIPT_S3_ENDPOINT TEST_DELETION_RECEIPT_S3_BUCKET
unset TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID TEST_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY
```

- [ ] **Step 6: Review diff, record gap, and commit**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: bind deletion receipts to key versions"
```

### Task 7: Trusted-proxy-aware auth throttling

**Files:**

- Modify: `apps/api/tests/http_safety.rs`
- Modify: `apps/api/src/http/rate_limit.rs`
- Modify: `apps/api/src/config.rs`
- Modify: `apps/api/src/app.rs`
- Modify: `apps/api/src/main.rs`
- Modify: `infra/v1/env.example`
- Modify: `infra/v1/traefik.md`
- Modify: `infra/v1/dokploy-compose.yml`
- Modify: `infra/v1/test-dokploy-compose.sh`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces:
  `TrustedProxyConfig { cidrs, edge_max_header_bytes: 8192, rust_suffix_bytes: 2048, max_hops: 16 }`;
  effective-client resolver; invalid trusted-forwarding response before auth handler.

- [ ] **Step 1: Write RED parser and middleware tests**

Test direct spoof ignored; trusted peer valid chain; malformed/excessive suffix rejected; two
clients behind same proxy retain distinct IP buckets; hostile left prefix plus real rightmost client
resolves real client; trusted address inside untrusted chain grants nothing.

```rust
let request = request_from_peer(proxy_ip)
    .header("x-forwarded-for", "malformed-prefix, 203.0.113.8");
assert_eq!(effective_client(&request), IpAddr::from([203, 0, 113, 8]));
```

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test http_safety -- --nocapture
```

- [ ] **Step 3: Implement bounded right-to-left resolver**

Parse CIDRs at startup. Ignore headers for untrusted direct peers. For trusted peers, walk from the
right and stop at first untrusted valid IP without parsing remaining prefix. Reject when no client
is established within bounds. Ensure server uses
`into_make_service_with_connect_info::<SocketAddr>()`.

- [ ] **Step 4: Document/test Traefik sanitization**

Document overwrite/safe-append and 8192-byte edge rejection. Extend compose contract test to assert
trusted-proxy environment and Traefik forwarding policy are explicit.

- [ ] **Step 5: Run GREEN and config tests**

```bash
cargo test -p cashmemo-api --test http_safety --test operations
bash infra/v1/test-dokploy-compose.sh
```

- [ ] **Step 6: Record gap and commit**

```bash
git add apps/api infra/v1 docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: resolve auth clients through trusted proxies"
```

### Task 8: Read-only schema-aware readiness

**Files:**

- Create: `apps/api/src/db/readiness.rs`
- Modify: `apps/api/src/db/mod.rs`
- Modify: `apps/api/src/db/target_guard.rs`
- Modify: `apps/api/src/app.rs`
- Modify: `apps/api/tests/operations.rs`
- Modify: `apps/api/tests/migrations.rs`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces: `check_latest_v1_readiness(&PgPool) -> Result<(), ReadinessError>` using only SELECTs.

- [ ] **Step 1: Write RED DB-state tests**

Create isolated current, empty, migration-prefix, failed/checksum-divergent, and unknown non-empty
databases. Assert `/api/v1/health/ready` returns 200 only for exact current V1 and never mutates
tables/history.

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test operations --test migrations -- --nocapture
```

- [ ] **Step 3: Extract read-only validator**

Reuse identity/checksum comparison without invoking migration or initialization. Map every mismatch
to 503 through canonical request ID.

- [ ] **Step 4: Run GREEN**

```bash
cargo test -p cashmemo-api --test operations --test migrations --test http_safety
```

- [ ] **Step 5: Record gap and commit**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: verify V1 migration state in readiness"
```

### Task 9: Canonical request IDs and safe structured logs

**Files:**

- Modify: `apps/api/src/auth/routes.rs`
- Modify: `apps/api/src/http/request_id.rs`
- Modify: `apps/api/src/http/origin.rs`
- Modify: `apps/api/src/http/rate_limit.rs`
- Modify: `apps/api/src/app.rs`
- Modify: `apps/api/tests/http_safety.rs`
- Modify: `apps/api/tests/operations.rs`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces one canonical request ID; log fields `request_id`, `method`, `route`, `status`,
  `latency_ms`, `service`, `version`; unmatched route constant.

- [ ] **Step 1: Write RED auth/body/header and log tests**

Assert forbidden current-session/revoke-all errors use exact incoming canonical UUID in header/body.
Capture structured logs for matched/unmatched routes and assert no raw URI/query/secrets.

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test http_safety --test operations -- --nocapture
```

- [ ] **Step 3: Thread existing RequestId and MatchedPath**

Add `Extension<RequestId>` to every auth error path. Capture method and `MatchedPath`; use
`"<unmatched>"` when absent. Keep attach middleware outermost so extractors/middleware reuse it.

- [ ] **Step 4: Run GREEN**

```bash
cargo test -p cashmemo-api --test http_safety --test operations --test auth
```

- [ ] **Step 5: Record gap and commit**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: keep request IDs consistent in errors and logs"
```

### Task 10: Exact monetary output invariant

**Files:**

- Modify: `apps/api/src/money.rs`
- Modify: `apps/api/src/wallets/service.rs`
- Modify: `apps/api/src/transactions/service.rs`
- Modify: `apps/api/src/budgets/service.rs`
- Modify: `apps/api/src/reporting/query.rs`
- Modify: `apps/api/tests/money.rs`
- Modify: `apps/api/tests/wallets.rs`
- Modify: `apps/api/tests/budgets.rs`
- Modify: `apps/api/tests/reporting.rs`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces: `format_exact_for_exponent(Decimal, u32) -> Result<String, MoneyError>`; separate
  `format_percentage_2dp` with `MidpointAwayFromZero`.

- [ ] **Step 1: Write RED corrupt-scale tests**

Assert `1.2300` formats as `1.23`, `1.231` at exponent 2 returns invariant error, valid negative net
formats exactly, share/budget percentage strings use two decimals, and authoritative endpoints do
not silently round injected corrupt rows.

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test money --test wallets --test budgets --test reporting -- --nocapture
```

- [ ] **Step 3: Centralize exact formatter**

Normalize Decimal, compare normalized scale with exponent, then rescale only after validation.
Remove authoritative `round_dp` formatters from services; retain explicit percentage rounding.

- [ ] **Step 4: Run GREEN and all API tests**

```bash
cargo test -p cashmemo-api
```

- [ ] **Step 5: Record gap and commit**

```bash
git add apps/api docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: reject inexact monetary output"
```

### Task 11: Deterministic portable recovery timestamps

**Files:**

- Create: `scripts/operations/utc-timestamp.mjs`
- Modify: `tests/operations/preservation-gate.bats`
- Modify: `tests/operations/restore-drill.bats`
- Create: `tests/operations/utc-timestamp.bats`
- Modify: `.github/workflows/v1-ci.yml`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces CLI `--base <RFC3339>|--now --offset-seconds <signed integer>` and strict UTC seconds.

- [ ] **Step 1: Write RED Bats helper tests**

```bash
run node scripts/operations/utc-timestamp.mjs \
  --base 2026-08-25T00:00:00Z --offset-seconds 600
[ "$status" -eq 0 ]
[ "$output" = "2026-08-25T00:10:00Z" ]
```

Also reject conflicting base/now, offsets, missing `Z`, milliseconds, impossible dates, malformed
timestamp, noninteger offset, and overflow after addition.

- [ ] **Step 2: Run RED on current tree**

```bash
bats tests/operations/utc-timestamp.bats
```

- [ ] **Step 3: Implement strict RFC3339 helper**

First require `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/`. Only then parse with `Date`; require
finite value and exact `toISOString().replace('.000Z', 'Z') === input` round trip so normalization
cannot accept impossible dates. Use checked integer-second addition; reject unsafe multiplication,
non-finite result, Date-range overflow, or output outside exact UTC-seconds form. Test fixtures pass
fixed bases; only convenience paths may use `--now`.

- [ ] **Step 4: Replace BSD date calls**

Change Bats fixtures to call helper with explicit `--base` and offset. Preserve test meaning; do not
skip recovery assertions.

- [ ] **Step 5: Pin Node in recovery CI**

In `.github/workflows/v1-ci.yml` recovery-safety job, add pinned
`actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` before Bats with
`node-version: 24.14.0`. Do not depend on Ubuntu preinstalled Node.

- [ ] **Step 6: Run focused and full operations suite**

```bash
bats tests/operations/utc-timestamp.bats
bats tests/operations/*.bats tests/repository/*.bats
```

- [ ] **Step 7: Review workflow/helper diff and record baseline CI failure**

- [ ] **Step 8: Commit slice**

```bash
git add scripts/operations tests/operations .github/workflows/v1-ci.yml docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: make recovery timestamps portable"
```

### Task 12: Reproducible clean web runtime image

**Files:**

- Modify: `infra/v1/web.Dockerfile`
- Create: `infra/v1/test-web-image.sh`
- Modify: `.github/workflows/v1-ci.yml`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Produces pinned patched Node 24 Bookworm-slim base; runtime with Node/standalone only; exact Trivy
  policy unchanged.

- [ ] **Step 1: Preserve failing scan evidence and add RED runtime contract**

The test script must fail current image because npm/npx/Corepack exist. It also starts container as
non-root, requests app endpoint, and records image digest.

```bash
docker build --pull -f infra/v1/web.Dockerfile -t cashmemo-web:repair-red .
bash infra/v1/test-web-image.sh cashmemo-web:repair-red
```

- [ ] **Step 2: Confirm Trivy RED under hosted-equivalent policy**

```bash
trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 \
  --pkg-types os,library cashmemo-web:repair-red
```

Expected: fixed Debian CVEs and npm `tar@7.5.7` reported.

- [ ] **Step 3: Resolve and record exact official base**

Resolve official `node:24.14.0-bookworm-slim` manifest digest from registry, record
source/tag/digest and lookup command in repair evidence, and pin Dockerfile `FROM` to that immutable
digest. Do not use an unrecorded moving tag in final Dockerfile.

- [ ] **Step 4: Build pinned base and rescan before package changes**

```bash
docker build --pull -f infra/v1/web.Dockerfile -t cashmemo-web:pinned-base .
trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 \
  --pkg-types os,library cashmemo-web:pinned-base
```

If fixable OS CVE remains, identify exact package/fixed version and add only narrow repair. No
blanket `apt-get upgrade`, ignore file, severity reduction, or undocumented suppression.

- [ ] **Step 5: Remove runtime package-manager entry points deliberately**

Copy standalone server/runtime dependencies into clean non-root runtime stage. Remove only known
npm/npx/Corepack entry points verified by `command -v`; do not recursively delete arbitrary Node
directories. Keep `node apps/web/server.js` executable.

- [ ] **Step 6: Run GREEN runtime and scan tests**

```bash
docker build --pull -f infra/v1/web.Dockerfile -t cashmemo-web:repair-green .
bash infra/v1/test-web-image.sh cashmemo-web:repair-green
trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 \
  --pkg-types os,library cashmemo-web:repair-green
```

- [ ] **Step 7: Record built image digest and review Docker diff**

Record `docker image inspect --format '{{index .RepoDigests 0}} {{.Id}}'` (fall back to image ID for
local-only image), non-root/runtime results, Trivy result, exact narrow package repair if any.

- [ ] **Step 8: Commit slice**

```bash
git add infra/v1 .github/workflows/v1-ci.yml docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "fix: harden the web runtime image"
```

### Task 13: Freeze Rust OpenAPI and regenerate Orval once coherently

**Files:**

- Modify: `apps/api/src/openapi.rs`
- Modify: `apps/api/tests/openapi.rs`
- Modify: `openapi/cashmemo-v1.json`
- Modify: `apps/web/generated/api/**`
- Modify: `apps/web/tests/api-client.spec.ts`
- Modify: `docs/verification/v1-pr3-repair-evidence.md`

**Interfaces:**

- Freezes all repaired DTOs before UI: cancellation password, local datetime writes, local dates,
  timezone defaults, opening balance update, read names, share percentage, and recent month.

- [ ] **Step 1: Write RED OpenAPI contract assertions**

Assert exact request/response field names and descriptions. `share_percent` must be OpenAPI string
with two-decimal/range documentation; `occurred_local` pattern is exact minute with no suffix;
`occurred_at` remains read-only canonical instant.

- [ ] **Step 2: Run RED contract test**

```bash
cargo test -p cashmemo-api --test openapi -- --nocapture
```

- [ ] **Step 3: Update Rust schemas only**

Add/adjust utoipa schemas for approved contract. Do not edit `openapi/cashmemo-v1.json` or
`apps/web/generated/api/**` manually.

- [ ] **Step 4: Generate and inspect expected surfaces**

```bash
pnpm api:generate
git status --short
git diff -- openapi/cashmemo-v1.json apps/web/generated/api
```

Never edit `apps/web/generated/api` manually.

- [ ] **Step 5: Stage expected generated baseline**

Review every generated field/type. Require changed paths outside Rust source/tests/docs to be only
`openapi/cashmemo-v1.json` and `apps/web/generated/api/**`, then stage all intended task changes.

```bash
git add apps/api/src/openapi.rs apps/api/tests/openapi.rs openapi/cashmemo-v1.json apps/web/generated/api apps/web/tests/api-client.spec.ts docs/verification/v1-pr3-repair-evidence.md
git diff --cached --name-only
```

- [ ] **Step 6: Regenerate against staged baseline and prove no drift anywhere**

```bash
pnpm api:generate
git diff --exit-code
git status --short
git diff --cached --name-only
cargo test -p cashmemo-api --test openapi
pnpm --dir apps/web vitest run tests/api-client.spec.ts
```

`git diff --exit-code` must be clean across entire tracked working tree, not only generated paths.
Cached path list must contain only approved Task 13 files.

- [ ] **Step 7: Review cached diff and commit contract freeze**

```bash
git add apps/api/src/openapi.rs apps/api/tests/openapi.rs openapi/cashmemo-v1.json apps/web/generated/api apps/web/tests/api-client.spec.ts docs/verification/v1-pr3-repair-evidence.md
git commit -S -m "feat: freeze repaired Cashmemo API contracts"
```

### Task 14: Tailwind and current shadcn/Base UI foundation

**Files:**

- Create: `apps/web/components.json`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/postcss.config.mjs`
- Modify: `apps/web/app/globals.css`
- Create/replace as generated: `apps/web/components/ui/button.tsx`
- Create/replace as generated: `apps/web/components/ui/input.tsx`
- Create: `apps/web/components/ui/card.tsx`
- Create: `apps/web/components/ui/label.tsx`
- Create: `apps/web/components/ui/separator.tsx`
- Create: `apps/web/components/ui/skeleton.tsx`
- Create: `apps/web/components/ui/sonner.tsx`
- Create: `apps/web/lib/utils.ts`
- Create: `apps/web/tests/design-system.spec.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/next.config.ts`
- Create: `docs/verification/v1-pr3-ui-primitive-inventory.md`

**Interfaces:**

- Produces current shadcn source backed consistently by Base UI; alias `@/components/ui`; semantic
  forest/neutral/amber CSS variables; one Sonner host; no bespoke parallel primitives.

- [ ] **Step 1: Inventory legacy interactive system**

Record every definition/import/consumer of old `Button`, `Input`, `Dialog`, `FormField`, raw
`<select>`, `.button-*`, `.input*` interaction styling, and homemade confirmation boxes. Each row:
path/symbol, consumers, classification (`replace`, `retain`), exact reason, owning migration task.
Native controls may be retained only with deliberate accessibility reason.

```bash
rg -n 'components/ui/(button|input|dialog|form-field)|<select\b|className=.*button-|className=.*input|confirm\(' apps/web --glob '!generated/**'
rg -n '^\.button-|^\.input|\[role="dialog"\]|aria-modal' apps/web --glob '*.{css,tsx}'
```

- [ ] **Step 2: Write RED foundation tests**

Test keyboard-focusable generated Button, semantic variants, 44px practical control sizing, exact
component alias/config presence, token names, and absence of legacy `.button-primary` behavior.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/design-system.spec.tsx
```

- [ ] **Step 4: Resolve and pin one shadcn CLI version**

Query current approved `shadcn` registry version once, record exact version in primitive inventory,
add exact (no caret/tilde) devDependency to `apps/web/package.json`, install lockfile, then use only
`pnpm --dir apps/web exec shadcn` for Tasks 14–24. Never resolve a moving generator tag again.

```bash
SHADCN_VERSION="$(pnpm view shadcn version --json | tr -d '"')"
printf '%s\n' "$SHADCN_VERSION"
pnpm --dir apps/web add --save-dev --save-exact "shadcn@$SHADCN_VERSION"
```

- [ ] **Step 5: Initialize existing app, not a new project**

```bash
pnpm --dir apps/web exec shadcn init --template next --base base --no-monorepo
```

Review `components.json` for TypeScript, Tailwind, CSS variables, and `@/components/ui`. Add only
foundation components consumed now:

```bash
pnpm --dir apps/web exec shadcn add button input card label separator skeleton sonner
```

- [ ] **Step 6: Verify generated Base UI substrate before customization**

Inspect generated imports: every interactive foundation component must use current shadcn Base UI
pattern, never Radix-era `asChild` snippets or parallel behavior. Commit `components.json` as source
of generator truth.

- [ ] **Step 7: Apply semantic theme tokens**

Define forest primary, neutral surfaces, restrained amber accent, separate semantic states, radii,
focus ring, and contrast-safe foreground pairs in `globals.css`. Do not add dark mode or scattered
raw hex values.

- [ ] **Step 8: Add layout/form conventions**

Define typography scale, spacing rhythm, page/form widths, tabular money class, action-row rules,
44px practical touch target, reduced-motion behavior, and bottom-safe-area variables. Mount one
Sonner host in root layout; no business state in toast.

- [ ] **Step 9: Run focused GREEN**

```bash
pnpm --dir apps/web vitest run tests/design-system.spec.tsx
```

- [ ] **Step 10: Run surrounding frontend checks**

```bash
pnpm --dir apps/web vitest run tests/design-system.spec.tsx
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

- [ ] **Step 11: Review generated/custom diff and update inventory**

Mark foundation primitives replaced; leave consumers assigned to Tasks 15–23. Verify no second
primitive API was added over shadcn.

- [ ] **Step 12: Commit foundation**

```bash
git add apps/web pnpm-lock.yaml docs/verification/v1-pr3-ui-primitive-inventory.md
git commit -S -m "feat: establish Cashmemo shadcn design system"
```

### Task 15: Auth pages, fragment tokens, and restricted routing

**Files:**

- Add via shadcn when consumed: `apps/web/components/ui/field.tsx`
- Add via shadcn when consumed: `apps/web/components/ui/alert.tsx`
- Modify: `apps/web/features/auth/forms.tsx`
- Modify: `apps/web/features/auth/use-session.ts`
- Modify: `apps/web/components/auth-gate.tsx`
- Modify: `apps/web/app/(public)/login/page.tsx`
- Modify: `apps/web/app/(public)/register/page.tsx`
- Modify: `apps/web/app/(public)/forgot-password/page.tsx`
- Modify: `apps/web/app/(public)/reset-password/page.tsx`
- Modify: `apps/web/app/(public)/verify-email/page.tsx`
- Create: `apps/web/app/(public)/layout.tsx`
- Modify: `apps/web/app/(auth)/deletion/page.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/tests/auth.spec.tsx`
- Modify: `apps/web/tests/cache-policy.spec.tsx`
- Modify: `apps/web/e2e/auth-onboarding.spec.ts`
- Modify: `apps/web/e2e/account-deletion.spec.ts`
- Modify: `apps/api/src/auth/email/smtp.rs`
- Modify: `apps/api/tests/auth.rs`

**Interfaces:**

- Produces fragment links, focused auth Card layout, enumeration-safe messages, restricted-mode
  routing that never mounts financial shell, and no token persistence.

- [ ] **Step 1: Write RED fragment and enumeration component tests**

Test `#token=` extraction, no query token, successful fragment clearing, no token in storage, same
registration/resend UX, and reset fragment retained only until successful consumption.

- [ ] **Step 2: Write RED restricted-mode and header tests**

Assert pending deletion exposed only after correct password, private cache cleared, no financial
request/navigation during restricted mode, `/verify-email` and `/reset-password` responses include
`Referrer-Policy: no-referrer`, and unrelated public pages keep normal policy.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/auth.spec.tsx tests/cache-policy.spec.tsx
cargo test -p cashmemo-api --test auth
```

- [ ] **Step 4: Generate pinned Base UI-backed Field and Alert**

```bash
pnpm --dir apps/web exec shadcn add field alert
```

- [ ] **Step 5: Rebuild login and registration forms**

Use Card/Input/Button/Field with RHF/Zod, linked field errors, pending buttons, concise password
guidance, enumeration-safe accepted registration copy, focused auth hierarchy, and mobile full-width
primary action.

- [ ] **Step 6: Rebuild forgot/reset/verify states**

Use same auth composition. Forgot/resend always show accepted/check-email state; reset keeps
password guidance concise; verify shows pending/success/retry without permanent layout success
banner. No third-party content.

- [ ] **Step 7: Implement fragment-token flow**

SMTP URLs use `#token=`. Client reads `window.location.hash`, submits token to Rust, never writes it
to storage, and clears fragment with `history.replaceState` only after successful
verification/reset. Password-reset page may keep fragment until form succeeds.

- [ ] **Step 8: Add restrictive token-page response policy**

Add exact `Referrer-Policy: no-referrer` entries for `/verify-email` and `/reset-password` in
`apps/web/next.config.ts`; retain existing authenticated no-store rules. Browser test reads actual
document response headers.

- [ ] **Step 9: Enforce restricted routing before app mount**

Session gate branches on returned access before rendering children or starting financial queries.
Clear query client immediately on DeletionOnly. Keep `/deletion` outside AppShell.

- [ ] **Step 10: Run focused GREEN component/API tests**

```bash
pnpm --dir apps/web vitest run tests/auth.spec.tsx tests/cache-policy.spec.tsx
cargo test -p cashmemo-api --test auth
```

- [ ] **Step 11: Run focused E2E tests**

```bash
pnpm --dir apps/web vitest run tests/auth.spec.tsx tests/cache-policy.spec.tsx
pnpm --dir apps/web exec playwright test e2e/auth-onboarding.spec.ts e2e/account-deletion.spec.ts
```

- [ ] **Step 12: Check mobile/desktop hierarchy, keyboard, field errors, focus, loading/success**

- [ ] **Step 13: Review diff, update primitive inventory, and commit**

```bash
git add apps/web apps/api/src/auth/email/smtp.rs apps/api/tests/auth.rs pnpm-lock.yaml
git commit -S -m "feat: rebuild secure authentication flows"
```

### Task 16: Responsive app shell and durable onboarding UX

**Files:**

- Evaluate/add via shadcn: `apps/web/components/ui/sidebar.tsx`
- Add via shadcn: `apps/web/components/ui/sheet.tsx`
- Add via shadcn: `apps/web/components/ui/combobox.tsx`
- Modify: `apps/web/components/app-shell/app-shell.tsx`
- Modify: `apps/web/components/app-shell/sidebar.tsx`
- Modify: `apps/web/components/app-shell/bottom-nav.tsx`
- Modify: `apps/web/app/(auth)/app/layout.tsx`
- Modify: `apps/web/features/onboarding/onboarding-flow.tsx`
- Modify: `apps/web/features/onboarding/use-onboarding.ts`
- Modify: `apps/web/features/onboarding/timezones.ts`
- Modify: `apps/web/tests/onboarding.spec.tsx`
- Modify: `apps/web/tests/accessibility.spec.tsx`
- Modify: `apps/web/e2e/auth-onboarding.spec.ts`

**Interfaces:**

- Produces shared desktop/mobile vocabulary; Add route navigation; safe-area content inset;
  searchable exact-IANA combobox; three backend-derived visible onboarding steps.

- [ ] **Step 1: Write RED shell navigation tests**

Assert mobile labels Overview/Transactions/Add/Budgets/More, Add href, More Sheet focus, no
horizontal scroll nav, safe-area content inset, desktop/mobile same information architecture, and
restricted mode cannot import/mount shell.

- [ ] **Step 2: Write RED onboarding tests**

Assert exact timezone value, browser-detected option first, three backend-derived steps, categories
not visible as step, refresh/back idempotency, and archived-only-wallet completed account remains in
app.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/onboarding.spec.tsx tests/accessibility.spec.tsx
```

- [ ] **Step 4: Generate pinned Sheet and Combobox**

```bash
pnpm --dir apps/web exec shadcn add sheet combobox
```

- [ ] **Step 5: Evaluate shadcn Sidebar against YAGNI criteria**

Compare generated Sidebar provider/menu/responsive behavior with current simple nav. Record choice
in primitive inventory. If chosen, generate with pinned CLI and remove unused workspace switcher,
nested/collapsible/resizable features. If simple semantic `<nav>` is smaller, retain it with reason;
do not create another sidebar primitive framework.

- [ ] **Step 6: Implement desktop shell**

Use neutral surface, forest active/action token, Lucide single icon set, text labels, logical
heading order, visible focus, and route-driven Add link. No financial data persistence or prefetch
change.

- [ ] **Step 7: Implement mobile shell**

Build fixed safe-area-aware bottom nav and More Sheet. Reserve global content bottom padding so nav
never covers focused controls, submit buttons, rows, or Load more.

- [ ] **Step 8: Run shell-focused GREEN tests**

```bash
pnpm --dir apps/web vitest run tests/accessibility.spec.tsx
```

- [ ] **Step 9: Implement onboarding step derivation**

Render Timezone when unconfigured, Currency when timezone configured/default missing, Wallet when
preferences configured/onboarding incomplete, otherwise `/app`. Use exact IANA Combobox, detected
zone first, backend state after every mutation, and no client step-state machine.

- [ ] **Step 10: Apply standard form actions and states**

Use Card/Field/Button, mobile full-width primary action, subordinate Back, stable Skeleton, inline
API/field errors, and accessible success progression. Category reconciliation stays backend-owned.

- [ ] **Step 11: Run focused GREEN and E2E**

```bash
pnpm --dir apps/web vitest run tests/onboarding.spec.tsx tests/accessibility.spec.tsx
pnpm --dir apps/web exec playwright test e2e/auth-onboarding.spec.ts
```

- [ ] **Step 12: Review responsive/focus diff and update inventory**

- [ ] **Step 13: Commit shell/onboarding**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: rebuild responsive shell and onboarding"
```

### Task 17: Currency-separated dashboard redesign

**Files:**

- Add via shadcn: `apps/web/components/ui/progress.tsx`
- Create: `apps/web/components/money/exact-decimal.ts`
- Modify: `apps/web/components/money/amount.tsx`
- Modify: `apps/web/components/money/currency-group.tsx`
- Modify: `apps/web/features/dashboard/dashboard.tsx`
- Modify: `apps/web/features/dashboard/monthly-summary.tsx`
- Modify: `apps/web/features/dashboard/recent-transactions.tsx`
- Modify: `apps/web/features/budgets/budget-progress.tsx`
- Modify: `apps/web/tests/dashboard.spec.tsx`
- Modify: `apps/web/tests/budgets.spec.tsx`

**Interfaces:**

- Produces exact string `MoneyAmount`; month URL state; server-percentage category bars; independent
  currency sections; stable Skeletons.

- [ ] **Step 1: Write RED exact money tests**

Test huge decimal string without Number/parseFloat, canonical scale preservation, grouping, and
income/expense sign plus explicit text/accessibility meaning.

- [ ] **Step 2: Write RED dashboard composition tests**

Test selected month applied to summary/budget/recent queries, no combined currency total,
currency-local category composition, category bar from `share_percent`, partial-section errors,
stable skeletons, and no-activity/no-budget distinct empty states.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/dashboard.spec.tsx tests/budgets.spec.tsx
```

- [ ] **Step 4: Generate pinned Progress component**

```bash
pnpm --dir apps/web exec shadcn add progress
```

- [ ] **Step 5: Implement exact decimal display helper**

Validate canonical signed decimal string, split sign/whole/fraction, group whole digits as strings,
and return display segments. `MoneyAmount` adds code/sign/context without recalculation or rounding.

- [ ] **Step 6: Run exact-money GREEN tests**

```bash
pnpm --dir apps/web vitest run tests/dashboard.spec.tsx -t "exact money"
```

- [ ] **Step 7: Implement selected-month query state**

Read/write `?month=YYYY-MM`; pass same month to monthly summary, budget summary, and recent
transactions. Reset only affected query keys when month changes.

- [ ] **Step 8: Implement independent currency sections**

Compose neutral grouped sections; each owns income/expense/net/category/budget context. Convert only
`share_percent` string to bounded JS number for bar width. Never share cross-currency scale or hero
total.

- [ ] **Step 9: Implement local loading/error/empty states**

Use stable Skeleton regions for summary/list/progress; keep successful sections visible if another
fails. Distinguish no activity, no budget, and section error actions.

- [ ] **Step 10: Run GREEN, accessibility, and build**

```bash
pnpm --dir apps/web vitest run tests/dashboard.spec.tsx tests/budgets.spec.tsx tests/accessibility.spec.tsx
pnpm --dir apps/web build
```

- [ ] **Step 11: Review financial hierarchy and update inventory**

- [ ] **Step 12: Commit dashboard**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: rebuild the currency-separated dashboard"
```

### Task 18: Route-driven transaction form and timezone round trip

**Files:**

- Add via shadcn when consumed: `apps/web/components/ui/select.tsx`
- Add via shadcn when consumed: `apps/web/components/ui/textarea.tsx`
- Add via shadcn when consumed: `apps/web/components/ui/radio-group.tsx`
- Modify: `apps/web/features/transactions/form.tsx`
- Modify: `apps/web/lib/validation/transaction.ts`
- Create: `apps/web/app/(auth)/app/transactions/[id]/edit/page.tsx`
- Remove: `apps/web/app/(auth)/app/transactions/[id]/page.tsx`
- Modify: `apps/web/tests/transaction-form.spec.tsx`
- Modify: `apps/web/e2e/transactions.spec.ts`

**Interfaces:**

- Produces one create/edit form; exact local-minute formatter using explicit IANA timezone;
  dirty-only `occurred_local`; canonical edit route.

- [ ] **Step 1: Write RED local-time payload tests**

Test entry-default timezone, UTC→configured-zone form display, create local-minute payload,
dirty-only update payload, datetime 422 field mapping, and no
`new Date(local).toISOString()`/browser timezone conversion.

- [ ] **Step 2: Write RED interaction tests**

Test expense/income segmented control, deterministic wallet selection, amount preservation on wallet
change, new exponent validation error without mutation, active direction-compatible categories, note
limit, pending/field errors, and canonical create/edit routes.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/transaction-form.spec.tsx
```

- [ ] **Step 4: Generate pinned form controls**

```bash
pnpm --dir apps/web exec shadcn add select textarea radio-group
```

- [ ] **Step 5: Implement timezone conversion helpers**

Convert canonical UTC instant to `YYYY-MM-DDTHH:mm` using
`Intl.DateTimeFormat(..., { timeZone, hourCycle: "h23" }).formatToParts()`. On edit use RHF dirty
state: omit `occurred_local` unless field dirty. Map Rust `fields.occurred_local` 422 directly to
datetime control.

- [ ] **Step 6: Run local-time GREEN tests**

```bash
pnpm --dir apps/web vitest run tests/transaction-form.spec.tsx -t "timezone|occurred_local"
```

- [ ] **Step 7: Implement transaction field hierarchy**

Use Base UI-backed Select/Textarea/RadioGroup, large exact amount, wallet/currency context, filtered
category, local datetime, note, and standard mobile/desktop actions. Format canonical instant
through `Intl.DateTimeFormat(..., { timeZone })` parts, never browser timezone.

- [ ] **Step 8: Wire canonical routes to one form**

Create page `/app/transactions/new` and edit page `/app/transactions/{id}/edit` import same form;
remove old detail-as-edit route. Preserve deep link, refresh, Back, focus, and no modal fork.

- [ ] **Step 9: Add real browser mismatch test**

Run Playwright context `America/Los_Angeles`, profile `Asia/Jakarta`, submit `2026-08-31T23:30`,
assert API UTC `2026-08-31T16:30:00Z`, reopen edit and assert `2026-08-31T23:30`.

- [ ] **Step 10: Run GREEN component/E2E tests**

```bash
pnpm --dir apps/web vitest run tests/transaction-form.spec.tsx
pnpm --dir apps/web exec playwright test e2e/transactions.spec.ts
```

- [ ] **Step 11: Check 375px/1280px keyboard, focus, error, pending states**

- [ ] **Step 12: Review diff, update inventory, and commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: rebuild timezone-safe transaction entry"
```

### Task 19: Compact transaction history, semantic filters, and Trash

**Files:**

- Add via shadcn when consumed: `apps/web/components/ui/dropdown-menu.tsx`
- Add via shadcn when consumed: `apps/web/components/ui/alert-dialog.tsx`
- Add via shadcn when consumed: `apps/web/components/ui/badge.tsx`
- Modify: `apps/web/features/transactions/filters.tsx`
- Modify: `apps/web/features/transactions/history-params.ts`
- Modify: `apps/web/features/transactions/history.tsx`
- Modify: `apps/web/features/transactions/trash.tsx`
- Modify: `apps/web/tests/history.spec.tsx`
- Modify: `apps/web/tests/trash.spec.tsx`
- Modify: `apps/web/e2e/history-trash.spec.ts`

**Interfaces:**

- Consumes semantic `from`/`to` dates, exact amounts, current names, opaque cursor, restore
  endpoint.
- Produces URL-persisted structured filters, ephemeral `q`, Apply/Clear mobile filter sheet,
  explicit Load more, real server Undo.

- [ ] **Step 1: Write RED history-row and filter tests**

Cover compact signed rows, Future badge, URL filters excluding `q`, mobile Apply/Clear batching,
page retention on pagination failure, filter/search reset, and context-sensitive empty actions.

- [ ] **Step 2: Write RED Trash lifecycle tests**

Cover Trash without confirmation, success toast Undo calling restore once, duplicate Undo blocked,
restore failure retained, permanent-delete AlertDialog, lifecycle timestamps in user timezone, and
targeted financial vs lifecycle invalidation.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/history.spec.tsx tests/trash.spec.tsx
```

- [ ] **Step 4: Generate pinned history primitives**

```bash
pnpm --dir apps/web exec shadcn add dropdown-menu alert-dialog badge
```

- [ ] **Step 5: Implement compact transaction row**

Use neutral list rows, exact `MoneyAmount`, current wallet/category names, row navigation, overflow
actions, explicit sign/direction, Future Badge, semantic date, visible focus, and accessible action
names. Mobile row tap opens edit; secondary actions stay in overflow.

- [ ] **Step 6: Implement structured URL filters and ephemeral search**

Persist only `from`, `to`, `type`, `wallet`, `category`. Keep `q` in component/form state. Mobile
Sheet edits draft state then Apply updates URL once; Clear all resets structured/query/search state.

- [ ] **Step 7: Implement explicit cursor pagination**

Append page on Load more success; keep loaded rows on failure; retry only failed next cursor;
filter/search change resets pages to first. Cursor stays opaque and outside URL.

- [ ] **Step 8: Implement Trash/Undo and permanent delete**

After server trash success remove row and show Sonner Undo. Undo invokes restore endpoint, then
invalidates affected history/wallet/month/budget/recent scopes. Permanent delete uses AlertDialog
and invalidates Trash/history lifecycle only. Use purge copy “Scheduled for automatic deletion after
…”.

- [ ] **Step 9: Add browser regression**

Exercise semantic local-day request, search privacy, filter application, Load more, Trash, server
restore Undo, failed restore feedback, and delete forever.

- [ ] **Step 10: Run GREEN**

```bash
pnpm --dir apps/web vitest run tests/history.spec.tsx tests/trash.spec.tsx
pnpm --dir apps/web exec playwright test e2e/history-trash.spec.ts
```

- [ ] **Step 11: Check mobile/desktop focus, filter, loading, empty, error states**

- [ ] **Step 12: Review diff, update inventory, and commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: rebuild transaction history and Trash"
```

### Task 20: Wallet and category management

**Files:**

- Replace via shadcn at first consumer: `apps/web/components/ui/dialog.tsx`
- Add via shadcn at first consumer: `apps/web/components/ui/tabs.tsx`
- Modify: `apps/web/features/wallets/wallet-list.tsx`
- Modify: `apps/web/features/wallets/wallet-form.tsx`
- Modify: `apps/web/features/categories/category-list.tsx`
- Modify: `apps/web/features/categories/category-form.tsx`
- Modify: `apps/web/tests/wallets.spec.tsx`
- Modify: `apps/web/tests/categories.spec.tsx`
- Create: `apps/web/e2e/wallets-categories.spec.ts`

**Interfaces:**

- Consumes editable `opening_balance`, immutable currency, authoritative hard-delete conflicts,
  archive side effects.
- Produces compact management rows, opening-balance editor, restrained archive confirmation,
  authoritative delete handling.

- [ ] **Step 1: Write RED wallet tests**

Cover exact opening balance edit, currency read-only, wallet/current-balance refresh only, archive
invalidating entry defaults and recurring queries, archive side-effect copy, restore without
auto-resume, hard-delete 409 context, dialog focus, and compact row hierarchy.

- [ ] **Step 2: Write RED category tests**

Cover Expense/Income Tabs, Show archived (not nested tabs), active/custom provenance hidden,
archive-pauses-recurring copy, restore without resume, hard-delete authoritative 409,
keyboard/focus, and compact rows.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/wallets.spec.tsx tests/categories.spec.tsx
```

- [ ] **Step 4: Generate pinned Dialog and Tabs once**

```bash
pnpm --dir apps/web exec shadcn add dialog tabs
```

Replace old homemade Dialog source/import behavior. Tasks 21–23 reuse this generated component; they
must not regenerate it.

- [ ] **Step 5: Rebuild wallet list and editor**

Use compact rows, exact `MoneyAmount`, currency read-only in edit Dialog, optional name/opening
balance payload with at least one changed field, inline server errors, pending state, and standard
actions. Opening-balance success invalidates wallet list/balance only.

- [ ] **Step 6: Implement wallet lifecycle actions**

Put edit/archive/restore/delete in DropdownMenu. Archive uses restrained consequence Dialog and
invalidates wallet, entry-default, recurring queries. Restore invalidates wallet/default queries but
never resumes rules. Hard delete uses AlertDialog; display 409 next to retained row.

- [ ] **Step 7: Run wallet GREEN tests**

```bash
pnpm --dir apps/web vitest run tests/wallets.spec.tsx
```

- [ ] **Step 8: Rebuild category tabs/list/editor**

Use one Expense/Income Tabs level, Show archived toggle, compact rows, Dialog form, current names,
and no built-in/custom distinction. Filter form choices for usability; Rust remains authoritative.

- [ ] **Step 9: Implement category lifecycle actions**

Use restrained archive consequence Dialog, restore without recurring mutation, and AlertDialog hard
delete with authoritative 409 explanation. Invalidate category + recurring on archive; category only
on restore.

- [ ] **Step 10: Add browser coverage**

Edit opening balance and prove wallet balance changes while history/month totals do not; archive
only wallet and remain in app; verify archive pauses dependent recurring rules and restore does not
resume them.

- [ ] **Step 11: Run combined GREEN**

```bash
pnpm --dir apps/web vitest run tests/wallets.spec.tsx tests/categories.spec.tsx
pnpm --dir apps/web exec playwright test e2e/wallets-categories.spec.ts
```

- [ ] **Step 12: Check mobile/desktop density, keyboard, focus, destructive hierarchy**

- [ ] **Step 13: Review diff, mark old Dialog removed in inventory, and commit**

```bash
git add apps/web
git commit -S -m "feat: rebuild wallet and category management"
```

### Task 21: Budget and recurring-rule management

**Files:**

- Modify: `apps/web/features/budgets/budget-list.tsx`
- Modify: `apps/web/features/budgets/budget-progress.tsx`
- Modify: `apps/web/features/budgets/budget-form.tsx`
- Modify: `apps/web/features/recurring/recurring-list.tsx`
- Modify: `apps/web/features/recurring/recurring-form.tsx`
- Modify: `apps/web/tests/budgets.spec.tsx`
- Modify: `apps/web/tests/recurring.spec.tsx`
- Modify: `apps/web/e2e/budgets-recurring.spec.ts`

**Interfaces:**

- Consumes exact budget money, decimal-string progress, local DATE `next_due_date`, active expense
  categories, backend recurrence authority.
- Produces compact finance-focused budget/rule views with future-only recurrence copy.

- [ ] **Step 1: Write RED budget tests**

Cover currency separation, >100% textual progress, negative exact remaining, graph-only clamp,
active expense choices, archived historical reference, exact create/edit payload, and proportionate
delete confirmation.

- [ ] **Step 2: Write RED recurring tests**

Cover date-only rendering without `Date`, explicit direction/amount/wallet/category/cadence, status
text/icons, pause/resume, future-only edit copy, non-backfill resume copy, and prior generated
transaction unchanged.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/budgets.spec.tsx tests/recurring.spec.tsx
```

- [ ] **Step 4: Rebuild budget list and Progress composition**

Use exact `MoneyAmount` for budgeted/spent/remaining. Parse only server progress string for visual
`Progress` clamped 0..100; keep textual 135.42%, Over budget text/icon, negative exact remaining.

- [ ] **Step 5: Rebuild budget form/lifecycle**

Offer active owned expense categories for new budgets; preserve/display archived historical category
during edit. Use current shadcn Dialog/Select/Form controls, field errors, pending states, and
proportionate delete confirmation.

- [ ] **Step 6: Run budget GREEN tests**

```bash
pnpm --dir apps/web vitest run tests/budgets.spec.tsx
```

- [ ] **Step 7: Rebuild recurring list**

Use compact rows, explicit text plus icon/sign, exact amount, current wallet/category, cadence,
semantic local `next_due_date` string, Badge status, and overflow actions. Never construct JS Date
from date-only value.

- [ ] **Step 8: Rebuild recurring form/lifecycle**

Reuse Dialog/Select/Form primitives. Show “Changes apply to future scheduled occurrences…” copy.
Pause says no paused-period occurrences; resume says first cadence date on/after resume and no
backfill. UI sends intent only; backend calculates dates.

- [ ] **Step 9: Add representative browser coverage**

Create/edit/delete budget; show over-budget state without color-only meaning;
create/edit/pause/resume recurrence; verify prior generated transaction unchanged.

- [ ] **Step 10: Run combined GREEN**

```bash
pnpm --dir apps/web vitest run tests/budgets.spec.tsx tests/recurring.spec.tsx
pnpm --dir apps/web exec playwright test e2e/budgets-recurring.spec.ts
```

- [ ] **Step 11: Check mobile/desktop density, field errors, loading/empty/error states**

- [ ] **Step 12: Review diff, update inventory, and commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: rebuild budgets and recurring rules"
```

### Task 22: Preferences, sessions, and timezone consequences

**Files:**

- Modify: `apps/web/features/settings/preferences-form.tsx`
- Modify: `apps/web/features/settings/session-controls.tsx`
- Modify: `apps/web/tests/settings.spec.tsx`
- Create: `apps/web/e2e/settings.spec.ts`

**Interfaces:**

- Produces timezone confirmation, exact targeted invalidation, default-currency copy, distinct
  sign-out semantics.

- [ ] **Step 1: Write RED timezone/default-currency tests**

Cover actual new timezone in confirmation; unchanged transaction/occurrence timestamps; invalidation
of profile, entry defaults, history, summary, budgets, recent, and current local forms; default
currency not recomputing finance.

- [ ] **Step 2: Write RED session-control tests**

Cover current logout vs logout-all, cookie/query cleanup, distinct confirmation intensity, minimal
current-session metadata, and absence of IP/device/geography labels.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir apps/web vitest run tests/settings.spec.tsx
```

- [ ] **Step 4: Rebuild preferences form**

Use existing shadcn Dialog/Combobox/Form controls. Group preferences, keep exact IANA value, mirror
new timezone in confirmation copy, keep default-currency meaning narrow, link errors, show pending
state, and never perform financial calculations.

- [ ] **Step 5: Implement exact timezone invalidation**

After success invalidate profile/preferences, transaction entry defaults, transaction/history,
monthly dashboard, budget/current month, month recent, and any mounted local-datetime form query. Do
not mutate transaction/occurrence cache values optimistically.

- [ ] **Step 6: Rebuild session controls**

Use compact section. Sign out calls current revoke then clears cookie/query cache. Sign out all uses
AlertDialog, revokes all including current, then clears/navigates. Display only current session and
useful created/expiry values already returned.

- [ ] **Step 7: Add browser regression**

Change timezone and confirm transaction instant remains unchanged while grouping/display changes;
immediately open Add Transaction and prove fresh timezone; test sign out and sign out all
cache/cookie behavior.

- [ ] **Step 8: Run GREEN**

```bash
pnpm --dir apps/web vitest run tests/settings.spec.tsx
pnpm --dir apps/web exec playwright test e2e/settings.spec.ts
```

- [ ] **Step 9: Check mobile/desktop form actions, focus, consequences, errors**

- [ ] **Step 10: Review diff, update inventory, and commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: clarify preferences and session controls"
```

### Task 23: Account-deletion UX and browser privacy boundary

**Files:**

- Modify: `apps/web/features/settings/account-deletion.tsx`
- Modify: `apps/web/app/(auth)/deletion/page.tsx`
- Modify: `apps/web/components/auth-gate.tsx`
- Create: `apps/web/lib/query-client.ts`
- Create: `apps/web/tests/account-deletion.spec.tsx`
- Modify: `apps/web/tests/cache-policy.spec.tsx`
- Modify: `apps/web/e2e/account-deletion.spec.ts`
- Modify: `apps/web/e2e/cache-isolation.spec.ts`

**Interfaces:**

- Consumes password-confirmed cancel, server `deletion_due_at`, restricted access mode.
- Produces separate restricted shell and verified clearing of private client state.

- [ ] **Step 1: Write RED account-deletion request tests**

Cover server deadline, backup-retention copy, password field, no preselected destructive
confirmation, atomic transition out of app shell, and in-flight response unable to repopulate cache.

- [ ] **Step 2: Write RED deletion-only cancellation tests**

Cover no AppShell/nav/providers, authoritative deadline, wrong-password inline retry preserving
restricted session, correct cancellation clearing cookie/cache and routing login, sign out, and no
normal financial requests.

- [ ] **Step 3: Write RED browser-storage/cache tests**

Assert financial/session token absent from localStorage/sessionStorage/IndexedDB/CacheStorage,
authenticated HTTP/RSC/API `no-store`, only server-issued HttpOnly session cookie, and late requests
cannot repopulate reusable private state.

- [ ] **Step 4: Run RED component tests**

```bash
pnpm --dir apps/web vitest run tests/account-deletion.spec.tsx tests/cache-policy.spec.tsx
```

- [ ] **Step 5: Centralize private-query cleanup**

Create one QueryClient owner/helper that cancels in-flight financial queries, removes private query
data, and prevents late completion from repopulating old client before navigation. Reuse for logout,
expiry, deletion request, restricted login, and successful cancellation.

- [ ] **Step 6: Implement account-deletion request page**

Deletion request stops queries, clears QueryClient, replaces shell, then navigates. `/deletion`
transition occurs only after server success. Show exact 7-day/live-data/backup-retention copy and
server `deletion_due_at`; do not calculate deadline in React or use manipulative confirmation.

- [ ] **Step 7: Implement separate deletion-only composition**

`/deletion` imports no AppShell/sidebar/bottom-nav/financial prefetch provider. It may reuse Card,
Input, Button, Alert. Show only Cancel account deletion and Sign out.

- [ ] **Step 8: Implement password-confirmed cancellation**

Send `{ password }`; map wrong password inline without logout. On success invoke centralized
cleanup, clear cookie via response, and replace route with `/login`. Disable duplicate submission.

- [ ] **Step 9: Add browser privacy evidence**

Assert no financial/session token in localStorage, sessionStorage, IndexedDB, or CacheStorage; only
static assets may exist in CacheStorage. Confirm secure HttpOnly cookie remains browser-managed.
Exercise restricted login, request, wrong/correct cancel, logout/session expiry, and late response
isolation.

- [ ] **Step 10: Run GREEN**

```bash
pnpm --dir apps/web vitest run tests/account-deletion.spec.tsx tests/cache-policy.spec.tsx
pnpm --dir apps/web exec playwright test e2e/account-deletion.spec.ts e2e/cache-isolation.spec.ts
```

- [ ] **Step 11: Check mobile/desktop focus, copy, non-manipulative destructive flow**

- [ ] **Step 12: Review diff, update inventory, and commit**

```bash
git add apps/web
git commit -S -m "feat: harden account deletion browser boundaries"
```

### Task 24: Responsive, accessibility, and human visual review

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/playwright.config.ts`
- Modify: `.gitignore`
- Create: `apps/web/e2e/accessibility.spec.ts`
- Create: `apps/web/e2e/visual-review.spec.ts`
- Create: `docs/verification/v1-pr3-visual-review.md`
- Modify: `.github/workflows/v1-ci.yml`

**Interfaces:**

- Produces bounded synthetic screenshot/trace evidence at `375x812`, `768x1024`, `1280x800`,
  `1440x900`; no pixel-diff gate.

- [ ] **Step 1: Pin exact axe Playwright dependency**

```bash
AXE_VERSION="$(pnpm view @axe-core/playwright version --json | tr -d '"')"
printf '%s\n' "$AXE_VERSION"
pnpm --dir apps/web add --save-dev --save-exact "@axe-core/playwright@$AXE_VERSION"
```

Record exact resolved version in visual review evidence. Import only:

```ts
import AxeBuilder from "@axe-core/playwright";
```

- [ ] **Step 2: Write RED focused axe checks**

Use `new AxeBuilder({ page }).analyze()` on login, dashboard, transaction form, history Sheet,
settings, and deletion-only page. Assert zero critical/serious violations; keep exclusions explicit
and justified in test source.

- [ ] **Step 3: Write RED behavioral accessibility checks**

Add keyboard traversal, dialog/sheet focus restoration, reduced-motion, 200% zoom/reflow, no
horizontal overflow, bottom-nav focus visibility, small-height/virtual-keyboard form reachability,
semantic headings, contrast checks, and non-color status assertions.

- [ ] **Step 4: Run RED**

```bash
pnpm --dir apps/web exec playwright test e2e/accessibility.spec.ts e2e/visual-review.spec.ts
```

- [ ] **Step 5: Configure private bounded artifacts**

Set Playwright output to ignored `apps/web/test-results/` and `apps/web/playwright-report/`; add
both to `.gitignore`. Configure trace/screenshot/video `retain-on-failure` for normal E2E and
screenshot capture for designated visual review. In workflow upload only those paths with
`if: failure()` for normal run or designated visual-review condition, `retention-days: 7`, and no
public publishing.

Add `workflow_dispatch` boolean input `capture_visual_review` and pinned upload step:

```yaml
- name: Upload private Playwright evidence
  if: ${{ !cancelled() && (failure() || inputs.capture_visual_review == true) }}
  uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
  with:
    name: playwright-evidence-${{ github.sha }}
    path: |
      apps/web/test-results/
      apps/web/playwright-report/
    if-no-files-found: ignore
    retention-days: 7
```

- [ ] **Step 6: Add synthetic fixture guard**

Fixture factory uses only `example.test` users and synthetic names/notes. Before capture parse
`CASHMEMO_V1_E2E_PUBLIC_ORIGIN`; permit only hostname `localhost`, `127.0.0.1`, or `[::1]`,
otherwise throw before authentication/artifact creation. Never log real credentials/tokens.

- [ ] **Step 7: Add realistic visual-review fixtures**

Capture login, onboarding, dashboard, new transaction, history/filters, wallets, budgets, recurring,
settings/deletion at fixed viewports. Include long names/note, large IDR, currencies, negative
remaining, >100% progress, archived/future states, crowded history, validation errors, and
long-scroll state.

- [ ] **Step 8: Capture exact viewport set**

Run `375x812`, `768x1024`, `1280x800`, `1440x900`; include at least one long-content scroll state.
Screenshots are review evidence, not brittle pixel-diff assertions.

- [ ] **Step 9: Perform first human-quality review**

Inspect every capture for hierarchy, typography, wrapping, density, touch targets, focus, overflow,
sticky overlap, destructive hierarchy, empty/loading/error/success state, and
forest-green/neutral/amber contrast. Record screen, viewport, evidence path, finding, disposition in
`v1-pr3-visual-review.md`.

- [ ] **Step 10: Fix one recorded visual/accessibility finding at a time**

For each finding, add/adjust focused component or browser assertion, confirm RED where behavioral,
make smallest CSS/composition change, rerun affected screen, then mark disposition. Do not bundle
unrelated screen redesigns.

- [ ] **Step 11: Run complete responsive/accessibility sweep**

```bash
pnpm --dir apps/web exec playwright test e2e/accessibility.spec.ts e2e/visual-review.spec.ts
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

- [ ] **Step 12: Scan for superseded primitive system**

Search definitions/imports/usages for old Button/Input/Dialog/FormField, raw `<select>`,
`.button-*`, legacy `.input*` interaction styles, and homemade confirmations. For every remaining
match, primitive inventory must say retained with concrete reason; otherwise remove it and rerun
consumer tests. Require one shadcn/Base UI interaction system.

```bash
rg -n 'components/ui/(button|input|dialog|form-field)|<select\b|className=.*button-|className=.*input|confirm\(' apps/web --glob '!generated/**'
rg -n '^\.button-|^\.input|\[role="dialog"\]|aria-modal' apps/web --glob '*.{css,tsx}'
```

- [ ] **Step 13: Review artifact privacy/config and update inventory**

- [ ] **Step 14: Commit visual evidence**

```bash
git add apps/web pnpm-lock.yaml .gitignore .github/workflows/v1-ci.yml docs/verification/v1-pr3-visual-review.md docs/verification/v1-pr3-ui-primitive-inventory.md
git commit -S -m "test: add responsive accessibility review gates"
```

### Task 25: Fresh local verification and accurate repair evidence

**Files:**

- Modify: `docs/verification/v1-pr3-repair-evidence.md`
- Modify: `docs/verification/v1-final-review.md`
- Modify: `docs/verification/v1-merge-readiness.md`
- Modify: `docs/verification/v1-production-readiness.md`

**Interfaces:**

- Produces reproducible local evidence; never claims production proof.

- [ ] **Step 1: Establish clean tracked baseline**

Commit all intended tracked changes; verify `git status --short` contains only separately reported
user-owned `.serena/`. Run `git diff --check`. Do not start verification with staged/unstaged
tracked changes.

- [ ] **Step 2: Reset only named disposable verification project**

```bash
docker compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml down --volumes --remove-orphans
docker compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml up -d --wait \
  postgres restored-postgres mailpit deletion-receipts
```

This project name scopes cleanup. Do not stop/remove unrelated containers or volumes.

- [ ] **Step 3: Export exact disposable test environment**

```bash
receipt_port="$(docker compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml port deletion-receipts 9000 | sed 's/.*://')"
export DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e
export TEST_RESTORED_DATABASE_URL=postgres://cashmemo_restore_e2e:cashmemo_restore_e2e@127.0.0.1:54330/cashmemo_restore_e2e
export TEST_DELETION_RECEIPT_S3_ENDPOINT="http://127.0.0.1:${receipt_port}"
export TEST_DELETION_RECEIPT_S3_BUCKET=cashmemo-v1-repair-task25
export TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID=deletion-receipt-test
export TEST_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY=deletion-receipt-test-secret
```

- [ ] **Step 4: Run existing root gates only**

```bash
export DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e
pnpm toolchain:check
pnpm install --frozen-lockfile
pnpm verify
pnpm test:operations
pnpm --dir apps/web exec playwright test
bats tests/operations/*.bats tests/repository/*.bats
git diff --check
```

- [ ] **Step 5: Run migration and feature-enabled receipt gates**

```bash
receipt_port="$(docker compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml port deletion-receipts 9000 | sed 's/.*://')"
export DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e
export TEST_RESTORED_DATABASE_URL=postgres://cashmemo_restore_e2e:cashmemo_restore_e2e@127.0.0.1:54330/cashmemo_restore_e2e
export TEST_DELETION_RECEIPT_S3_ENDPOINT="http://127.0.0.1:${receipt_port}"
export TEST_DELETION_RECEIPT_S3_BUCKET=cashmemo-v1-repair-task25
export TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID=deletion-receipt-test
export TEST_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY=deletion-receipt-test-secret
cargo test --locked -p cashmemo-api --test migrations
DATABASE_URL="$TEST_RESTORED_DATABASE_URL" \
  cargo test --locked -p cashmemo-api --features s3-receipts --test deletion_receipt_replay
cargo build --locked --release -p cashmemo-api --features s3-receipts
```

Use environment from Step 3. Prove empty/current/stale/wrong schema behavior and idempotent receipt
replay against isolated restored PostgreSQL + MinIO; no hidden shell prerequisites.

- [ ] **Step 6: Run dependency audit**

```bash
pnpm --dir apps/web audit --prod --audit-level high
```

- [ ] **Step 7: Build and scan API image**

```bash
docker build --file infra/v1/api.Dockerfile --tag cashmemo-v1-api:task25 .
trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 \
  --pkg-types os,library cashmemo-v1-api:task25
```

- [ ] **Step 8: Build, contract-test, and scan web image**

```bash
docker build --file infra/v1/web.Dockerfile --tag cashmemo-v1-web:task25 .
bash infra/v1/test-web-image.sh cashmemo-v1-web:task25
trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 \
  --pkg-types os,library cashmemo-v1-web:task25
```

- [ ] **Step 9: Record image/runtime results**

Record API/web image IDs/digests, Trivy policy/results, web non-root/app response, and absence of
npm/npx/Corepack.

- [ ] **Step 10: Record evidence without overstating production**

Record command, toolchain (`Rust 1.97.1`, Node `24.14.0`, pnpm `11.13.1`), result, timestamp,
commit, and limitations. Local disposable MinIO/restore PASS proves mechanism only; production
backup, receipt store, restore, deployment, and cutover remain NOT READY.

- [ ] **Step 11: Clean exact disposable environment**

```bash
docker compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml down --volumes --remove-orphans
unset DATABASE_URL TEST_RESTORED_DATABASE_URL TEST_DELETION_RECEIPT_S3_ENDPOINT
unset TEST_DELETION_RECEIPT_S3_BUCKET TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID
unset TEST_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY
```

- [ ] **Step 12: Review evidence diff and commit local evidence**

```bash
git add docs/verification
git commit -S -m "docs: record PR 3 repair verification"
```

### Task 26: Exact-target hosted CI and independent merge-readiness review

**Files:**

- Modify: `docs/verification/v1-pr3-repair-evidence.md`
- Modify: `docs/verification/v1-final-review.md`
- Modify: `docs/verification/v1-merge-readiness.md`

**Interfaces:**

- Produces final recommendation only: `REQUEST CHANGES` or `READY FOR HUMAN MERGE REVIEW`.

- [ ] **Step 1: Freeze implementation head A**

Require Task 25 committed, tracked tree clean, and local verification green. Set
`IMPLEMENTATION_HEAD_A="$(git rev-parse HEAD)"`; record it in working notes without changing files.

- [ ] **Step 2: Push and verify remote A**

Push `rewrite/cashmemo-v1`, fetch remote, and require `git rev-parse origin/rewrite/cashmemo-v1`
equals `$IMPLEMENTATION_HEAD_A`. Record exact current `BASE_A="$(git rev-parse origin/main)"`. Do
not merge or change PR draft state automatically.

- [ ] **Step 3: Verify hosted CI/merge result for A**

Record PR head SHA, base/main SHA, and GitHub PR merge-result SHA/ref. Require green: Rust fmt,
Clippy, PostgreSQL tests, release S3 build, frontend lint/typecheck/Vitest/build, OpenAPI/Orval
drift, real-stack Playwright, migration safety, recovery/preservation, dependency audit, API/web
Docker build and uncompromised Trivy. If any fails, return to owning TDD task; after repair rerun
Task 25 and redefine A.

- [ ] **Step 4: Independently review A through two diffs**

Review `e59bf67c59dc0c31ffb3fef3b56f68bea4331f10...$IMPLEMENTATION_HEAD_A` for focused repair and
`$BASE_A...$IMPLEMENTATION_HEAD_A` for whole replacement. Recheck dangerous unchanged areas:
auth/session, money, timezone, recurrence, lifecycle, ownership, migration protection,
caching/privacy, generated API, CI/infrastructure, UI shell, original PR Task 26
executable-configuration/whitespace changes, and ESLint cleanup.

- [ ] **Step 5: Resolve A review findings before evidence commit**

Use `superpowers:requesting-code-review` with both diffs and full approved spec. Resolve every
required finding via new TDD slice and repeat Task 25 plus Steps 1–5. No “mostly green”
substitution.

- [ ] **Step 6: Write exact-A evidence and commit docs-only head B**

Update three evidence documents with A head/base/merge-result/job results, independent review, and
production NOT READY. Do not claim final recommendation inside repository because B is not yet
verified. Commit docs only:

```bash
git add docs/verification/v1-pr3-repair-evidence.md docs/verification/v1-final-review.md docs/verification/v1-merge-readiness.md
git diff --cached --name-only
git commit -S -m "docs: record PR 3 hosted repair evidence"
FINAL_HEAD_B="$(git rev-parse HEAD)"
```

- [ ] **Step 7: Prove A-to-B delta is docs-only expected evidence**

```bash
git diff --name-only "$IMPLEMENTATION_HEAD_A" "$FINAL_HEAD_B"
git diff "$IMPLEMENTATION_HEAD_A" "$FINAL_HEAD_B" -- docs/verification
```

Require only three approved evidence files and no executable/generated/config change.

- [ ] **Step 8: Push B and verify remote SHA**

Push branch and require remote SHA equals `$FINAL_HEAD_B`. Nothing may modify HEAD after this point.

- [ ] **Step 9: Verify B against current main**

Fetch main; record `BASE_B`. Require hosted CI for PR head B and GitHub merge-result ref against
`BASE_B` all green, including every required job. Inspect
`e59bf67c59dc0c31ffb3fef3b56f68bea4331f10...$FINAL_HEAD_B` and `$BASE_B...$FINAL_HEAD_B`.

- [ ] **Step 10: Revalidate moving target immediately before recommendation**

Fetch main again. If current SHA differs from `$BASE_B`, evidence stale: repeat mergeability, full
diff, hosted merge-result CI, and relevant independent review against new base. Do not commit
another evidence document.

- [ ] **Step 11: Report final recommendation without repository mutation**

If any required gate/review unresolved, record `REQUEST CHANGES`. Only when all exact-current-target
gates pass, report `READY FOR HUMAN MERGE REVIEW` in agent final response/PR review. Include A, B,
current base, merge-result SHA, and job matrix. Keep production NOT READY. Make no further commit,
push, merge, draft-state change, deployment, or production action.

## Execution stop boundary

Plan execution may push repaired branch and inspect PR/CI because user requested remote
verification. It must not merge, deploy, mutate Dokploy production resources, access production
database, run production migrations, change production routing, cut over traffic, or perform
destructive legacy-data action. Human merge authorization remains separate.
