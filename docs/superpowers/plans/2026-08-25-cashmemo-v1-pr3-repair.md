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

## Test Environment

Focused PostgreSQL commands assume fresh disposable services:

```bash
docker compose -f infra/v1/test-compose.yml up -d postgres mailpit
export DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e
export PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH
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

- [ ] **Step 1: Write RED integration tests**

Add tests proving wrong password preserves `pending_deletion` and token; correct password revokes
token, clears cookie, requires fresh login, and fresh login is `Full`. Correct the race assertion to
allow deletion-only sessions while rejecting full access. Add request-deletion cookie-clear test.

```rust
assert_eq!(cancel_wrong.status(), StatusCode::UNAUTHORIZED);
assert_eq!(auth.session(&restricted_token).await.unwrap().access, SessionAccess::DeletionOnly);
assert!(cancel_ok.headers()[SET_COOKIE].to_str().unwrap().contains("Max-Age=0"));
assert_eq!(auth.session(&restricted_token).await, Err(AuthError::Unauthorized));
assert_eq!(auth.login(email, password).await.unwrap().access, SessionAccess::Full);
```

- [ ] **Step 2: Run RED tests**

```bash
cargo test -p cashmemo-api --test account_deletion --test auth -- --nocapture
```

Expected: cancellation body/cookie/revocation assertions fail; race test demonstrates prior
zero-session expectation is invalid under one ordering.

- [ ] **Step 3: Implement lock-safe cancellation**

Load `(password_hash, status)` first, verify Argon2id outside transaction, then begin transaction
and lock:

```sql
SELECT password_hash, status::text
FROM users
WHERE id = $1
FOR UPDATE
```

Require locked hash and status equal verified values, update to active, revoke all sessions, commit.
Expose shared cookie expiry helper and return it from successful request/cancel routes.

- [ ] **Step 4: Run GREEN and surrounding auth suite**

```bash
cargo test -p cashmemo-api --test account_deletion --test auth --test ownership
```

- [ ] **Step 5: Record test correction and commit**

Record previous zero-session expectation, approved contradiction, corrected no-full-session
expectation, and protected regression in repair evidence.

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

Cover Jakarta conversion, ambiguous New York time choosing earlier instant, nonexistent time 422,
seconds/offset/Z rejection, and omitted update preserving exact stored instant.

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

- [ ] **Step 3: Implement strict conversion**

Parse exact 16-character local minute. Resolve `LocalResult::Single`, choose `min()` for Ambiguous,
and reject None. Load user timezone inside service transaction; never use browser/host timezone.

- [ ] **Step 4: Run GREEN and ownership tests**

```bash
cargo test -p cashmemo-api --test transactions --test ownership
```

- [ ] **Step 5: Record gap and commit**

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

- [ ] **Step 3: Implement shared boundaries and exact percentage**

Parse date-only query values; resolve start and next-day start with shared timezone helper. Add
joins for current names. Compute category share with exact Decimal division and
`MidpointAwayFromZero`, rescaled to 2, range `0.00..100.00`.

- [ ] **Step 4: Run GREEN and budget suite**

```bash
cargo test -p cashmemo-api --test history --test reporting --test budgets
```

- [ ] **Step 5: Record gap and commit**

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

- [ ] **Step 2: Run RED**

```bash
cargo test -p cashmemo-api --test wallets --test onboarding --test migrations -- --nocapture
```

- [ ] **Step 3: Add migration and implementation**

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

Service locks wallet, reads exponent, validates exact nonnegative balance, updates optional fields,
and sets onboarding completion transactionally after first qualifying wallet.

- [ ] **Step 4: Run GREEN plus reporting/transaction suites**

```bash
cargo test -p cashmemo-api --test wallets --test onboarding --test migrations --test reporting --test transactions
```

- [ ] **Step 5: Record test correction and commit**

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
cargo test -p cashmemo-api --test deletion_receipt_replay -- --nocapture
```

- [ ] **Step 3: Replace all-key search with exact lookup**

For each canonical receipt, resolve one key by declared version and compute only that candidate
HMAC. Keep canonical-body/object-key validation before matching and transactional deletion
afterward.

- [ ] **Step 4: Run GREEN plus S3 receipt tests**

```bash
cargo test -p cashmemo-api --test deletion_receipt_replay --test deletion_receipts --features s3-receipts
```

- [ ] **Step 5: Record gap and commit**

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

Also reject conflicting base/now, malformed base, and noninteger offset.

- [ ] **Step 2: Run RED on current tree**

```bash
bats tests/operations/utc-timestamp.bats
```

- [ ] **Step 3: Implement helper and replace BSD date calls**

Use `Date.parse`, checked millisecond addition, and `toISOString().replace('.000Z','Z')`. Test
fixtures pass fixed bases; only convenience paths may use `--now`.

- [ ] **Step 4: Run full operations suite**

```bash
bats tests/operations/*.bats tests/repository/*.bats
```

- [ ] **Step 5: Record baseline CI failure and commit**

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

- [ ] **Step 3: Pin patched base and deliberately prune runtime tools**

Select current patched official Node 24 Bookworm-slim digest. If one fixable OS package remains,
narrowly install only fixed package version. Remove official-image npm/npx/Corepack paths
explicitly, then verify `node apps/web/server.js` still starts.

- [ ] **Step 4: Run GREEN runtime and scan tests**

```bash
docker build --pull -f infra/v1/web.Dockerfile -t cashmemo-web:repair-green .
bash infra/v1/test-web-image.sh cashmemo-web:repair-green
trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 \
  --pkg-types os,library cashmemo-web:repair-green
```

- [ ] **Step 5: Record base/built digests and commit**

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

- [ ] **Step 3: Update Rust schemas and export/generate**

```bash
pnpm api:generate
```

Never edit `apps/web/generated/api` manually.

- [ ] **Step 4: Verify deterministic clean generation**

```bash
git diff -- openapi/cashmemo-v1.json apps/web/generated/api
git add openapi/cashmemo-v1.json apps/web/generated/api
pnpm api:generate
git diff --exit-code -- openapi/cashmemo-v1.json apps/web/generated/api
cargo test -p cashmemo-api --test openapi
pnpm --dir apps/web vitest run tests/api-client.spec.ts
```

The first diff is reviewed expected generation; after staging generated surfaces, second generation
must produce no further diff and must touch no unrelated file.

- [ ] **Step 5: Commit contract freeze**

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

**Interfaces:**

- Produces current shadcn source backed consistently by Base UI; alias `@/components/ui`; semantic
  forest/neutral/amber CSS variables; one Sonner host; no bespoke parallel primitives.

- [ ] **Step 1: Write RED foundation tests**

Test keyboard-focusable generated Button, semantic variants, 44px practical control sizing, exact
component alias/config presence, token names, and absence of legacy `.button-primary` behavior.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/design-system.spec.tsx
```

- [ ] **Step 3: Initialize existing app, not a new project**

```bash
pnpm dlx shadcn@latest init --template next --base base --cwd apps/web --no-monorepo
```

Review `components.json` for TypeScript, Tailwind, CSS variables, and `@/components/ui`. Add only
foundation components consumed now:

```bash
pnpm dlx shadcn@latest add button input card label separator skeleton sonner --cwd apps/web
```

- [ ] **Step 4: Apply approved tokens and layout primitives**

Define forest primary, neutral surfaces, restrained amber accent, separate semantic states, radii,
spacing, focus ring, typography, tabular money, page/form widths, reduced-motion behavior, and
bottom-safe-area variables. Do not add dark mode.

- [ ] **Step 5: Run GREEN, lint, and build**

```bash
pnpm --dir apps/web vitest run tests/design-system.spec.tsx
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

- [ ] **Step 6: Commit foundation**

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -S -m "feat: establish Cashmemo shadcn design system"
```

### Task 15: Auth pages, fragment tokens, and restricted routing

**Files:**

- Add via shadcn when consumed: `apps/web/components/ui/field.tsx`
- Add via shadcn when consumed: `apps/web/components/ui/alert.tsx`
- Modify: `apps/web/features/auth/forms.tsx`
- Modify: `apps/web/features/auth/use-session.ts`
- Modify: `apps/web/components/auth-gate.tsx`
- Modify: `apps/web/app/(public)/**/page.tsx`
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

- [ ] **Step 1: Write RED component/browser tests**

Test `#token=` extraction, no query token, successful fragment clearing, no token in storage, same
registration/resend UX, correct pending-deletion redirect only after valid credentials, private
cache clear, and no financial request/navigation during restricted mode.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/auth.spec.tsx tests/cache-policy.spec.tsx
cargo test -p cashmemo-api --test auth
```

- [ ] **Step 3: Generate Base UI-backed field/alert and rebuild auth forms**

```bash
pnpm dlx shadcn@latest add field alert --cwd apps/web
```

Use Card/Input/Button/Field, persistent check-email state, concise password guidance, and no
third-party content. Email URLs use fragment. Client reads `window.location.hash`; verification
clears via `history.replaceState` after success.

- [ ] **Step 4: Enforce restricted routing before app mount**

Session gate branches on returned access before rendering children or starting financial queries.
Clear query client immediately on DeletionOnly. Keep `/deletion` outside AppShell.

- [ ] **Step 5: Run GREEN component and focused E2E tests**

```bash
pnpm --dir apps/web vitest run tests/auth.spec.tsx tests/cache-policy.spec.tsx
pnpm --dir apps/web exec playwright test e2e/auth-onboarding.spec.ts e2e/account-deletion.spec.ts
```

- [ ] **Step 6: Commit auth UI**

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

- [ ] **Step 1: Write RED shell/onboarding tests**

Assert mobile labels Overview/Transactions/Add/Budgets/More, Add href, More Sheet focus, no
horizontal scroll nav, exact timezone value, browser-detected option first, categories not visible
as a step, and archived-only-wallet completed account remains in app.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/onboarding.spec.tsx tests/accessibility.spec.tsx
```

- [ ] **Step 3: Add only consumed shadcn shell components**

Generate Sheet and Combobox. Evaluate Sidebar generated source against simple needs; keep only if it
reduces code without workspace/nesting/resizing complexity.

- [ ] **Step 4: Rebuild shell and onboarding**

Use neutral shell, forest active/action tokens, Lucide icons with text, safe-area layout token, and
three-step Card flow. Seed categories idempotently in backend-driven progression without exposing a
fourth step.

- [ ] **Step 5: Run GREEN at component/E2E level**

```bash
pnpm --dir apps/web vitest run tests/onboarding.spec.tsx tests/accessibility.spec.tsx
pnpm --dir apps/web exec playwright test e2e/auth-onboarding.spec.ts
```

- [ ] **Step 6: Commit shell/onboarding**

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

- [ ] **Step 1: Write RED exact/render tests**

Test huge decimal string without Number conversion, income/expense sign+text, selected month applied
to all three queries, no combined currency total, category bar from `share_percent`, and over-budget
text 135.42% with graphical clamp only.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/dashboard.spec.tsx tests/budgets.spec.tsx
```

- [ ] **Step 3: Implement exact grouping and financial hierarchy**

Split sign/whole/fraction as strings; group whole digits without numeric conversion. Use server
percentage number only for visual width/Progress. Compose neutral currency sections and local query
errors/empty states.

- [ ] **Step 4: Run GREEN, accessibility, and build**

```bash
pnpm --dir apps/web vitest run tests/dashboard.spec.tsx tests/budgets.spec.tsx tests/accessibility.spec.tsx
pnpm --dir apps/web build
```

- [ ] **Step 5: Commit dashboard**

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

- [ ] **Step 1: Write RED form tests**

Test direction control, wallet precision, amount preservation, entry-default timezone, UTC→local
display, dirty-only payload, datetime 422 field mapping, and no `new Date(local).toISOString()`.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/transaction-form.spec.tsx
```

- [ ] **Step 3: Add consumed shadcn controls and rebuild form**

Use Base UI-backed Select/Textarea/RadioGroup, large exact amount, wallet/currency context, filtered
category, local datetime, note, and standard mobile/desktop actions. Format canonical instant
through `Intl.DateTimeFormat(..., { timeZone })` parts, never browser timezone.

- [ ] **Step 4: Add real browser mismatch test**

Run Playwright context `America/Los_Angeles`, profile `Asia/Jakarta`, submit `2026-08-31T23:30`,
assert API UTC `2026-08-31T16:30:00Z`, reopen edit and assert `2026-08-31T23:30`.

- [ ] **Step 5: Run GREEN component/E2E tests**

```bash
pnpm --dir apps/web vitest run tests/transaction-form.spec.tsx
pnpm --dir apps/web exec playwright test e2e/transactions.spec.ts
```

- [ ] **Step 6: Commit transaction form**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: rebuild timezone-safe transaction entry"
```

### Task 19: Compact transaction history, semantic filters, and Trash

**Files:**

- Add via shadcn when consumed: `apps/web/components/ui/dropdown-menu.tsx`
- Add via shadcn when consumed: `apps/web/components/ui/alert-dialog.tsx`
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

- [ ] **Step 1: Write RED history and Trash tests**

Cover compact signed rows, Future badge, URL filters excluding `q`, mobile Apply/Clear batching,
page retention on pagination failure, filter reset, Trash without confirmation, Undo calling restore
once, permanent-delete AlertDialog, and targeted invalidation.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/history.spec.tsx tests/trash.spec.tsx
```

- [ ] **Step 3: Rebuild history and Trash**

Use neutral list rows, exact `MoneyAmount`, current wallet/category names, row navigation, overflow
actions, applied filter badges, responsive Sheet, explicit Load more, local pending/retry, and purge
copy “Scheduled for automatic deletion after …”. Permanent deletion alone receives maximum-danger
confirmation.

- [ ] **Step 4: Add browser regression**

Exercise semantic local-day request, search privacy, filter application, Load more, Trash, server
restore Undo, failed restore feedback, and delete forever.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --dir apps/web vitest run tests/history.spec.tsx tests/trash.spec.tsx
pnpm --dir apps/web exec playwright test e2e/history-trash.spec.ts
```

- [ ] **Step 6: Commit history**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: rebuild transaction history and Trash"
```

### Task 20: Wallet and category management

**Files:**

- Modify: `apps/web/features/wallets/wallet-list.tsx`
- Modify: `apps/web/features/wallets/wallet-form.tsx`
- Modify: `apps/web/features/categories/category-list.tsx`
- Modify: `apps/web/features/categories/category-form.tsx`
- Modify: `apps/web/tests/wallets.spec.tsx`
- Modify: `apps/web/tests/categories.spec.tsx`
- Modify: `apps/web/e2e/wallets-categories.spec.ts`

**Interfaces:**

- Consumes editable `opening_balance`, immutable currency, authoritative hard-delete conflicts,
  archive side effects.
- Produces compact management rows, opening-balance editor, restrained archive confirmation,
  authoritative delete handling.

- [ ] **Step 1: Write RED screen tests**

Cover exact opening balance edit, currency read-only, wallet/current-balance refresh only, archive
invalidating entry defaults and recurring queries, category Expense/Income tabs, Show archived,
archive side-effect copy, restore without auto-resume, hard-delete 409 context, keyboard/focus
behavior.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/wallets.spec.tsx tests/categories.spec.tsx
```

- [ ] **Step 3: Rebuild compact management surfaces**

Use rows rather than per-record giant cards. Put secondary actions in DropdownMenu. Use
proportionate confirmation for archive and AlertDialog for hard delete. Never infer delete
eligibility client-side.

- [ ] **Step 4: Add browser coverage**

Edit opening balance and prove wallet balance changes while history/month totals do not; archive
only wallet and remain in app; verify archive pauses dependent recurring rules and restore does not
resume them.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --dir apps/web vitest run tests/wallets.spec.tsx tests/categories.spec.tsx
pnpm --dir apps/web exec playwright test e2e/wallets-categories.spec.ts
```

- [ ] **Step 6: Commit management UI**

```bash
git add apps/web
git commit -S -m "feat: rebuild wallet and category management"
```

### Task 21: Budget and recurring-rule management

**Files:**

- Add via shadcn when consumed: `apps/web/components/ui/tabs.tsx`
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

- [ ] **Step 1: Write RED component tests**

Cover currency separation, >100% textual progress, negative exact remaining, graph-only clamp,
active expense choices, archived historical reference, date-only rendering without `Date`, status
text/icons, pause/resume, future-only edit copy, and non-backfill resume copy.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/budgets.spec.tsx tests/recurring.spec.tsx
```

- [ ] **Step 3: Rebuild budget and recurrence screens**

Use exact money strings; only parse server percentage for visual Progress. Keep delete-budget
confirmation proportionate. Present rule meaning, cadence, next local date, active/paused state, and
future-only effects without database language.

- [ ] **Step 4: Add representative browser coverage**

Create/edit/delete budget; show over-budget state without color-only meaning;
create/edit/pause/resume recurrence; verify prior generated transaction unchanged.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --dir apps/web vitest run tests/budgets.spec.tsx tests/recurring.spec.tsx
pnpm --dir apps/web exec playwright test e2e/budgets-recurring.spec.ts
```

- [ ] **Step 6: Commit finance management UI**

```bash
git add apps/web pnpm-lock.yaml
git commit -S -m "feat: rebuild budgets and recurring rules"
```

### Task 22: Preferences, sessions, and timezone consequences

**Files:**

- Add via shadcn when consumed: `apps/web/components/ui/dialog.tsx`
- Modify: `apps/web/features/settings/preferences-form.tsx`
- Modify: `apps/web/features/settings/session-controls.tsx`
- Modify: `apps/web/tests/settings.spec.tsx`
- Modify: `apps/web/e2e/settings.spec.ts`

**Interfaces:**

- Produces timezone confirmation, exact targeted invalidation, default-currency copy, distinct
  sign-out semantics.

- [ ] **Step 1: Write RED settings tests**

Cover actual new timezone in confirmation; unchanged transaction/occurrence timestamps; invalidation
of profile, entry defaults, history, summary, budgets, recent, and current local forms; default
currency not recomputing finance; current logout vs logout-all; minimal session metadata.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web vitest run tests/settings.spec.tsx
```

- [ ] **Step 3: Rebuild settings sections**

Group Preferences and Sessions/Security. Explain timezone consequences exactly. Keep default
currency meaning narrow. Use current-session data only; no IP/device/geography fields.

- [ ] **Step 4: Add browser regression**

Change timezone and confirm transaction instant remains unchanged while grouping/display changes;
immediately open Add Transaction and prove fresh timezone; test sign out and sign out all
cache/cookie behavior.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --dir apps/web vitest run tests/settings.spec.tsx
pnpm --dir apps/web exec playwright test e2e/settings.spec.ts
```

- [ ] **Step 6: Commit settings**

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
- Modify: `apps/web/tests/account-deletion.spec.tsx`
- Modify: `apps/web/tests/cache-policy.spec.ts`
- Modify: `apps/web/e2e/account-deletion.spec.ts`
- Modify: `apps/web/e2e/cache-isolation.spec.ts`

**Interfaces:**

- Consumes password-confirmed cancel, server `deletion_due_at`, restricted access mode.
- Produces separate restricted shell and verified clearing of private client state.

- [ ] **Step 1: Write RED deletion/privacy tests**

Cover server deadline, backup-retention copy, password field, no preselected destructive
confirmation, atomic transition out of app shell, in-flight response unable to repopulate cache,
wrong-password retry preserving restricted session, correct cancellation clearing cookie/cache, and
no normal financial requests in restricted mode.

- [ ] **Step 2: Run RED component tests**

```bash
pnpm --dir apps/web vitest run tests/account-deletion.spec.tsx tests/cache-policy.spec.ts
```

- [ ] **Step 3: Implement purpose-built flows**

Deletion request stops queries, clears QueryClient, replaces shell, then navigates. `/deletion`
imports no AppShell/financial provider. Cancellation sends password, maps invalid credentials
inline, and on success clears state before `/login`.

- [ ] **Step 4: Add browser privacy evidence**

Assert no financial/session token in localStorage, sessionStorage, IndexedDB, or CacheStorage; only
static assets may exist in CacheStorage. Confirm secure HttpOnly cookie remains browser-managed.
Exercise restricted login, request, wrong/correct cancel, logout/session expiry, and late response
isolation.

- [ ] **Step 5: Run GREEN**

```bash
pnpm --dir apps/web vitest run tests/account-deletion.spec.tsx tests/cache-policy.spec.ts
pnpm --dir apps/web exec playwright test e2e/account-deletion.spec.ts e2e/cache-isolation.spec.ts
```

- [ ] **Step 6: Commit deletion/privacy UI**

```bash
git add apps/web
git commit -S -m "feat: harden account deletion browser boundaries"
```

### Task 24: Responsive, accessibility, and human visual review

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/accessibility.spec.ts`
- Create: `apps/web/e2e/visual-review.spec.ts`
- Create: `docs/verification/v1-pr3-visual-review.md`
- Modify: `.github/workflows/v1-ci.yml`

**Interfaces:**

- Produces bounded synthetic screenshot/trace evidence at `375x812`, `768x1024`, `1280x800`,
  `1440x900`; no pixel-diff gate.

- [ ] **Step 1: Write RED accessibility/browser checks**

Add focused axe checks, keyboard traversal, dialog/sheet focus restoration, reduced-motion, 200%
zoom/reflow, no horizontal overflow, bottom-nav focus visibility, small-height/virtual-keyboard form
reachability, semantic headings, and non-color status assertions.

- [ ] **Step 2: Run RED**

```bash
pnpm --dir apps/web exec playwright test e2e/accessibility.spec.ts e2e/visual-review.spec.ts
```

- [ ] **Step 3: Add realistic synthetic fixtures and review capture**

Capture login, onboarding, dashboard, new transaction, history/filters, wallets, budgets, recurring,
settings/deletion at fixed viewports. Include long names/note, large IDR, currencies, negative
remaining, >100% progress, archived/future states, crowded history, validation errors, and
long-scroll state. Artifacts use synthetic users only and bounded CI retention.

- [ ] **Step 4: Perform human-quality review and fix findings**

Inspect every capture for hierarchy, typography, wrapping, density, touch targets, focus, overflow,
sticky overlap, destructive hierarchy, empty/loading/error/success state, and
forest-green/neutral/amber contrast. Record screen, viewport, evidence path, finding, disposition in
`v1-pr3-visual-review.md`.

- [ ] **Step 5: Run complete responsive/accessibility sweep**

```bash
pnpm --dir apps/web exec playwright test e2e/accessibility.spec.ts e2e/visual-review.spec.ts
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

- [ ] **Step 6: Commit visual evidence**

```bash
git add apps/web pnpm-lock.yaml .github/workflows/v1-ci.yml docs/verification/v1-pr3-visual-review.md
git commit -S -m "test: add responsive accessibility review gates"
```

### Task 25: Fresh local verification and accurate repair evidence

**Files:**

- Create: `docs/verification/v1-pr3-repair-evidence.md`
- Modify: `docs/verification/v1-final-review.md`
- Modify: `docs/verification/v1-merge-readiness.md`
- Modify: `docs/verification/v1-production-readiness.md`

**Interfaces:**

- Produces reproducible local evidence; never claims production proof.

- [ ] **Step 1: Establish clean baseline**

Commit all intended tracked changes; verify `git status --short` contains only separately reported
user-owned `.serena/`. Stop stale dev services. Remove only disposable V1 test containers/volumes
named by repository Compose config; do not touch unknown/user infrastructure.

- [ ] **Step 2: Start fresh disposable dependencies**

Start clean PostgreSQL, Mailpit, and S3-compatible receipt storage using repository test Compose.
Run migrations against explicitly disposable V1 DB; prove empty/wrong/stale readiness cases with
isolated databases.

- [ ] **Step 3: Run complete repository gates**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo build --release --workspace --features s3-receipts
pnpm openapi:check
pnpm orval:check
bats tests/operations/*.bats
pnpm --dir apps/web exec playwright test
```

- [ ] **Step 4: Build and scan runtime images**

Build API and web images. Record built digests. Run Trivy with `CRITICAL,HIGH`,
`ignore-unfixed: true`, `os,library`, exit code 1. Prove web runs as non-root, serves app/health,
and lacks npm/npx/Corepack.

- [ ] **Step 5: Run recovery/preservation checks**

Run migration safety, deletion-receipt idempotent replay, isolated restore replay, and deterministic
Bats tests using synthetic/disposable services. State explicitly this is local mechanism proof, not
production backup/restore proof.

- [ ] **Step 6: Clean disposable environment and document evidence**

Stop/remove only named disposable services/volumes. Record command, toolchain (`Rust 1.97.1`),
result, timestamp, commit, and limitations. Keep repository merge/deployment/production readiness
separate; production stays NOT READY.

- [ ] **Step 7: Commit local evidence**

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

- [ ] **Step 1: Push exact reviewed branch head**

Push `rewrite/cashmemo-v1`; record local head SHA and confirm remote branch SHA matches. Record
exact current `main` SHA. Do not merge or change PR out of draft automatically.

- [ ] **Step 2: Verify hosted merge-result CI**

Record PR head SHA, base/main SHA, and GitHub PR merge-result SHA/ref. Require green: Rust fmt,
Clippy, PostgreSQL tests, release S3 build, frontend lint/typecheck/Vitest/build, OpenAPI/Orval
drift, real-stack Playwright, migration safety, recovery/preservation, dependency audit, API/web
Docker build and uncompromised Trivy.

- [ ] **Step 3: Inspect two diffs**

Review `e59bf67c59dc0c31ffb3fef3b56f68bea4331f10...<final-head>` for focused repair correctness and
`<recorded-main>...<final-head>` for whole replacement. Recheck dangerous unchanged areas:
auth/session, money, timezone, recurrence, lifecycle, ownership, migration protection,
caching/privacy, generated API, CI/infrastructure, UI shell, original PR Task 26
executable-configuration/whitespace changes, and ESLint cleanup.

- [ ] **Step 4: Obtain independent review**

Use `superpowers:requesting-code-review` with both diffs and full approved spec. Resolve every
required finding via new TDD slice and repeat affected local/hosted gates. No “mostly green”
substitution.

- [ ] **Step 5: Revalidate moving target**

Immediately before recommendation, compare current main SHA with recorded base. If changed, mark
evidence stale; repeat mergeability, full diff, merge-result CI, and relevant review.

- [ ] **Step 6: Record recommendation and commit evidence**

If any required gate/review unresolved, record `REQUEST CHANGES`. Only when all exact-current-target
gates pass, record `READY FOR HUMAN MERGE REVIEW`. Keep production NOT READY.

```bash
git add docs/verification
git commit -S -m "docs: record exact-target merge review"
```

## Execution stop boundary

Plan execution may push repaired branch and inspect PR/CI because user requested remote
verification. It must not merge, deploy, mutate Dokploy production resources, access production
database, run production migrations, change production routing, cut over traffic, or perform
destructive legacy-data action. Human merge authorization remains separate.
