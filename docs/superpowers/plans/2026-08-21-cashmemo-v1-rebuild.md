# Cashmemo V1 Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace legacy Cashmemo with a mobile-first personal money journal built as an independent
Next.js + Rust/Axum + PostgreSQL modular monolith, then remove legacy code after verification and
preservation gates pass.

**Architecture:** Build V1 temporarily under `v1/` with an isolated PostgreSQL target, migration
history, API contracts, and deployment configuration. Rust owns authentication, authorization,
validation, money, recurrence, lifecycle, and reporting; Next.js consumes generated REST clients and
owns presentation only. After V1 verification and the data-preservation decision, promote V1 to
canonical `apps/web` and `apps/api`, remove legacy implementation, merge, then perform production
cutover separately.

**Tech Stack:** Rust, Axum, Tokio, Tower, tower-http, Serde, SQLx, rust_decimal, Argon2id, tracing,
PostgreSQL; Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui/Base UI, React Hook Form, Zod,
TanStack Query, Axios, Orval; Vitest, React Testing Library, Playwright; Docker, GitHub Actions,
Dokploy/Traefik, pgBackRest.

**Spec:** `docs/superpowers/specs/2026-08-21-cashmemo-v1-rebuild-design.md`

## Global Constraints

- Read the approved spec before every task; spec wins if this plan and spec differ.
- Classification is `ARCHITECTURAL`; implementation follows Superpowers TDD and stops at every task
  review gate.
- V1 and legacy use separate databases, migration histories, and `DATABASE_URL` values throughout
  parallel development.
- V1 migrations run only against an explicitly approved empty database or a database with valid
  Cashmemo V1 identity metadata; unknown non-empty targets fail closed.
- Store money as PostgreSQL `NUMERIC(20,4)`, Rust `Decimal`, and JSON decimal strings. Reject
  unsupported scale before SQL. Never use floating point for authoritative money work.
- Support only configured ISO 4217 currencies with exponent `0..=4`; never combine currencies and
  never silently round.
- Passwords are 15–128 Unicode code points, at most 512 UTF-8 bytes, accept spaces/Unicode, have no
  composition rules, and are never truncated.
- Every financial query is explicitly scoped by authenticated `user_id`; composite ownership foreign
  keys enforce same-user references. V1 does not require RLS.
- Unsafe browser methods require exact configured `Origin`; `GET`, `HEAD`, and `OPTIONS` never
  mutate state.
- One Rust API replica is the V1 assumption. Auth throttling is bounded in-memory middleware; no
  Redis and no persistent attempt history.
- Authenticated HTML/RSC/API financial content uses `Cache-Control: no-store` and is absent from
  service-worker, browser HTTP, Next.js, CDN/Traefik, localStorage, and IndexedDB caches.
- Database `TEXT` columns remain untruncated. Rust authoritatively enforces wallet/category names
  `1..=80` code points after trim, transaction notes `0..=500`, and history search `0..=100` after
  trim. Frontend mirrors these limits.
- Store instants as UTC `TIMESTAMPTZ`; month and recurrence behavior uses the user's current IANA
  timezone as specified.
- Scheduled commands are bounded and idempotent. Dokploy invokes commands in the API image; no
  long-running jobs service.
- No automatic migrations at API startup. Migration is an explicit one-shot deployment operation.
- Do not modify or retire legacy migrations until the preservation gate resolves existing-data
  handling.
- Do not add excluded V1 features, Redux, Zustand, Redis, microservices, GraphQL, CQRS, event
  sourcing, or offline financial write synchronization.
- Legacy TypeScript `TS7053` in `apps/server/tests/unit/error-mapper.spec.ts:30` is a pre-existing
  baseline issue, not rewrite scope.
- No implementation task authorizes merge, production deployment, production migration, destructive
  legacy-data action, or route cutover.

## Planned File Structure

Temporary parallel-build paths:

```text
Cargo.toml                         Rust workspace containing v1/api
rust-toolchain.toml                pinned Rust toolchain
v1/api/
  Cargo.toml
  src/{lib.rs,main.rs,app.rs,config.rs,error.rs,openapi.rs}
  src/bin/export_openapi.rs
  src/db/{mod.rs,migrate.rs,target_guard.rs}
  src/http/{mod.rs,auth.rs,cache.rs,origin.rs,request_id.rs,rate_limit.rs}
  src/{currency,money,time}.rs
  src/auth/{mod.rs,model.rs,password.rs,service.rs,routes.rs,email.rs}
  src/onboarding/{mod.rs,service.rs,routes.rs}
  src/wallets/{mod.rs,service.rs,routes.rs}
  src/categories/{mod.rs,service.rs,routes.rs}
  src/transactions/{mod.rs,service.rs,query.rs,routes.rs}
  src/budgets/{mod.rs,service.rs,routes.rs}
  src/recurring/{mod.rs,service.rs,processor.rs,routes.rs}
  src/reporting/{mod.rs,query.rs,routes.rs}
  src/accounts/{mod.rs,deletion.rs,routes.rs}
  migrations/*.sql
  tests/{support,auth,ownership,money,wallets,categories,transactions,history,budgets,recurring,reporting,account_deletion,migrations}.rs
v1/web/
  app/{layout.tsx,page.tsx,manifest.ts}
  app/(public)/** app/(auth)/** app/app/**
  components/{app-shell,money,forms,ui}/**
  features/{auth,onboarding,wallets,categories,transactions,budgets,recurring,dashboard,settings}/**
  lib/{api,auth,query,format,validation}/**
  generated/api/**
  tests/** e2e/** public/sw.js
  package.json next.config.ts orval.config.ts playwright.config.ts vitest.config.ts
openapi/cashmemo-v1.json           deterministic Rust-generated contract
infra/v1/{api.Dockerfile,web.Dockerfile,dokploy-compose.yml,env.example,traefik.md}
infra/backup/{pgbackrest.conf.example,restore-runbook.md}
scripts/{verify-v1-db-target.sh,preservation-audit.sh,verify-restore.sh}
.github/workflows/v1-ci.yml
```

Final canonical paths after the repository-replacement task:

```text
apps/api                           promoted from v1/api
apps/web                           promoted from v1/web
openapi/cashmemo-v1.json           retained
infra/v1/**                        retained and renamed only where canonical naming requires it
legacy implementation             removed after preservation decision and full verification
```

## Specification Coverage Map

- Product scope, privacy, non-goals, modular-monolith boundary: Global Constraints and Tasks 1–25.
- Repository isolation, clean schema, preservation uncertainty, selective reuse: Tasks 1, 21, 23,
  24, 25.
- Relational model, money, currencies, ownership, timezone: Tasks 2, 6–13.
- Authentication, sessions, CSRF, enumeration, throttling, recovery: Tasks 3, 4, 13, 15.
- Wallets, categories, onboarding: Tasks 5–7 and 16.
- Transactions, Trash, history, search, pagination: Tasks 8, 9, and 17.
- Budgets, recurrence, dashboard/reporting: Tasks 10–12 and 18.
- Account deletion race closure and anti-resurrection: Tasks 13, 18, and 21.
- REST/OpenAPI/Orval and thin frontend state ownership: Tasks 14–18.
- Major UX flows, responsive behavior, accessibility, PWA/cache privacy: Tasks 15–19.
- Runtime topology, configuration, logs, health/readiness, scheduled commands: Task 20.
- PostgreSQL backup/restore, receipt retention, rollback, preservation gate: Task 21.
- PostgreSQL integration tests, frontend tests, CI quality gates: Tasks 2–13, 19, and 22.
- Parallel verification, merge readiness, canonical replacement, production readiness separation:
  Tasks 23–25.

---

### Task 1: Bootstrap Isolated Rust API and Fail-Closed Migration Target

**Files:**

- Create: `Cargo.toml`, `rust-toolchain.toml`, `v1/api/Cargo.toml`
- Create: `v1/api/src/{lib.rs,main.rs,app.rs,config.rs,error.rs}`
- Create: `v1/api/src/db/{mod.rs,migrate.rs,target_guard.rs}`
- Create: `v1/api/migrations/0001_v1_identity.sql`
- Create: `v1/api/tests/{support/mod.rs,migrations.rs}`
- Create: `scripts/verify-v1-db-target.sh`

**Interfaces:**

- Produces: `AppConfig::from_env() -> Result<AppConfig, ConfigError>`,
  `build_app(AppState) -> Router`, and
  `assert_v1_migration_target(&PgPool) -> Result<TargetState, TargetError>`.
- Produces CLI commands: `cashmemo-api serve`, `cashmemo-api migrate`,
  `cashmemo-api process-recurring`, `cashmemo-api purge-trash`, `cashmemo-api purge-accounts`,
  `cashmemo-api cleanup-auth-tokens`.

- [ ] **Step 1: Add PostgreSQL integration harness and failing target-guard tests**

```rust
#[sqlx::test]
async fn unknown_non_empty_database_is_rejected(pool: PgPool) {
    sqlx::query("CREATE TABLE alien_data(id bigint primary key)")
        .execute(&pool).await.unwrap();
    assert!(matches!(assert_v1_migration_target(&pool).await, Err(TargetError::UnknownNonEmpty)));
}

#[sqlx::test]
async fn empty_or_identified_v1_database_is_allowed(pool: PgPool) {
    assert_eq!(assert_v1_migration_target(&pool).await.unwrap(), TargetState::Empty);
}
```

- [ ] **Step 2: Run migration tests and confirm missing target guard**

Run: `cargo test -p cashmemo-api --test migrations`

Expected: FAIL because `assert_v1_migration_target` and V1 metadata do not exist.

- [ ] **Step 3: Implement workspace, CLI dispatch, metadata migration, and guard**

`0001_v1_identity.sql` creates a single-row `cashmemo_schema_identity(product, generation)` table
with `('cashmemo','v1')`. Guard queries `pg_catalog.pg_tables`; it allows zero user tables or exact
V1 identity, and rejects every other non-empty target before `sqlx::migrate!()`.

```rust
pub enum Command { Serve, Migrate, ProcessRecurring, PurgeTrash, PurgeAccounts, CleanupAuthTokens }
pub enum TargetState { Empty, CashmemoV1 }
```

- [ ] **Step 4: Verify isolated migration lifecycle**

Run:
`cargo fmt --check && cargo clippy -p cashmemo-api --all-targets -- -D warnings && cargo test -p cashmemo-api --test migrations`

Expected: PASS; API startup does not invoke migrations.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml rust-toolchain.toml v1/api scripts/verify-v1-db-target.sh
git commit -m "build: bootstrap isolated Cashmemo V1 API"
```

### Task 2: Establish Schema, Currency, Money, and Time Invariants

**Files:**

- Create: `v1/api/migrations/0002_core_schema.sql`
- Create: `v1/api/src/{currency.rs,money.rs,time.rs}`
- Create: `v1/api/tests/{money.rs,ownership.rs}`

**Interfaces:**

- Produces: `CurrencyCode`, `CurrencyCatalog::require_supported(&str)`,
  `Money::parse_for_currency(&str, CurrencyCode)`, `UserTimezone`, and core table keys/constraints
  used by all domain tasks.
- `Money::decimal() -> Decimal`; serialization returns a JSON string preserving exact value.

- [ ] **Step 1: Write failing exactness, scale, range, and timezone tests**

```rust
#[test]
fn rejects_excess_scale_without_rounding() {
    let idr = CurrencyCode::try_from("IDR").unwrap();
    assert_eq!(Money::parse_for_currency("1.1", idr).unwrap_err(), MoneyError::ExcessScale);
}

#[test]
fn preserves_four_digit_currency_exactly() {
    let clf = CurrencyCode::try_from("CLF").unwrap();
    assert_eq!(Money::parse_for_currency("12.3456", clf).unwrap().to_string(), "12.3456");
}
```

Integration tests insert excess scale only through an intentionally raw SQL defense-in-depth case
and prove application parsing rejects it before SQL execution.

- [ ] **Step 2: Run focused tests and confirm missing domain types**

Run: `cargo test -p cashmemo-api --test money --test ownership`

Expected: FAIL because currency, money, time, and schema constraints are absent.

- [ ] **Step 3: Implement configured currency catalog and core relational schema**

Create tables and enums specified in Sections 11–12: `users`, `sessions`, `auth_tokens`, `wallets`,
`categories`, `transactions`, `budgets`, `recurring_rules`, `recurring_occurrences`. Use
`NUMERIC(20,4)`, positive amounts, immutable currency relationships, `TIMESTAMPTZ`, composite unique
keys `(user_id,id)`, composite ownership FKs, partial active-category name uniqueness, and required
lifecycle checks.

```rust
pub struct CurrencyDefinition { pub code: &'static str, pub exponent: u32 }
pub const SUPPORTED: &[CurrencyDefinition] = &[
    CurrencyDefinition { code: "IDR", exponent: 0 },
    CurrencyDefinition { code: "USD", exponent: 2 },
    CurrencyDefinition { code: "EUR", exponent: 2 },
    CurrencyDefinition { code: "JPY", exponent: 0 },
    CurrencyDefinition { code: "KWD", exponent: 3 },
    CurrencyDefinition { code: "CLF", exponent: 4 },
];
```

- [ ] **Step 4: Verify constraints against real PostgreSQL**

Run: `cargo test -p cashmemo-api --test money --test ownership --test migrations`

Expected: PASS, including cross-user FK rejection and active/Trash field consistency.

- [ ] **Step 5: Commit**

```bash
git add v1/api/migrations/0002_core_schema.sql v1/api/src/currency.rs v1/api/src/money.rs v1/api/src/time.rs v1/api/tests
git commit -m "feat: define V1 money and ownership schema"
```

### Task 3: Add HTTP Safety, Errors, Request IDs, Cache Policy, and Auth Throttling

**Files:**

- Create: `v1/api/src/http/{mod.rs,cache.rs,origin.rs,request_id.rs,rate_limit.rs}`
- Modify: `v1/api/src/{app.rs,config.rs,error.rs}`
- Create: `v1/api/tests/http_safety.rs`

**Interfaces:**

- Produces canonical error envelope `{ error: { code, message, field_errors?, request_id } }`.
- Produces `RequestId`, exact-origin middleware, `Cache-Control: no-store`, and endpoint-class rate
  limit layers.
- Maps authentication, authorization, hidden absence, validation, conflict, throttling, and
  unexpected failures consistently to `401`, `403`, opaque `404`, `422`, `409`, `429`, and
  content-free `500` responses carrying the canonical request ID.

- [ ] **Step 1: Write failing middleware contract tests**

```rust
#[tokio::test]
async fn unsafe_request_requires_exact_origin() { /* POST absent, suffix, and foreign Origin => 403 */ }

#[tokio::test]
async fn canonical_request_id_is_returned_in_header_and_error() { /* validated inbound or generated UUID */ }

#[tokio::test]
async fn auth_limit_returns_429_without_persistent_attempt_rows() { /* bounded in-memory limiter */ }
```

- [ ] **Step 2: Run focused tests**

Run: `cargo test -p cashmemo-api --test http_safety`

Expected: FAIL because middleware is absent.

- [ ] **Step 3: Implement middleware with exact rules**

Reject unsafe requests with absent or non-equal `Origin`; accept only size/format-valid incoming
`X-Request-Id`, otherwise generate UUID; set `no-store` on authenticated responses; configure
separate bounded limits for register, verification resend, login, and reset request. Document
single-replica assumption in `AppConfig` comments and expose thresholds through environment
variables.

- [ ] **Step 4: Verify middleware and API smoke route**

Run: `cargo test -p cashmemo-api --test http_safety && cargo test -p cashmemo-api`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add v1/api/src/http v1/api/src/app.rs v1/api/src/config.rs v1/api/src/error.rs v1/api/tests/http_safety.rs
git commit -m "feat: enforce V1 HTTP safety boundaries"
```

### Task 4: Implement Registration, Verification, Login, Sessions, and Recovery

**Files:**

- Create: `v1/api/src/auth/{mod.rs,model.rs,password.rs,email.rs,service.rs,routes.rs}`
- Create: `v1/api/migrations/0003_auth_constraints.sql`
- Modify: `v1/api/src/{app.rs,config.rs}`
- Create: `v1/api/tests/auth.rs`

**Interfaces:**

- Produces `/api/v1/auth/register`, `/verify-email`, `/verification/resend`, `/login`, `/logout`,
  `/sessions/current`, `/sessions/revoke-all`, `/password-reset/request`, `/password-reset/consume`.
- Produces `AuthSession { user_id: Uuid, access: Full | DeletionOnly, session_id: Uuid }` extractor.

- [ ] **Step 1: Write failing auth integration tests**

Cover conservative email normalization, 15/128 code-point and 512-byte password boundaries, Argon2id
hashes, SHA-256 lookup of 256-bit random tokens, single-use/expiry/replacement invalidation, login
enumeration, verified-email gate only after correct password, secure `__Host-cashmemo_session`
cookie, seven-day approximate idle expiry, hard 30-day absolute expiry, hourly `last_seen_at`
writes, logout current, logout all, and password-reset transactional session revocation.

```rust
assert_same_public_error(login("missing@example.com", "correct-looking-passphrase"), login(existing, "wrong-passphrase"));
assert_no_raw_token_in_database_or_logs(verification.raw);
```

- [ ] **Step 2: Run auth tests**

Run: `cargo test -p cashmemo-api --test auth`

Expected: FAIL because routes and services do not exist.

- [ ] **Step 3: Implement auth service and minimal email boundary**

```rust
#[async_trait]
pub trait EmailSender: Send + Sync {
    async fn send_verification(&self, to: &str, raw_token: &str) -> Result<(), EmailError>;
    async fn send_password_reset(&self, to: &str, raw_token: &str) -> Result<(), EmailError>;
}
```

Normalize email with trim + lowercase only; do not strip dots, plus aliases, or provider-specific
forms. Benchmark initial Argon2id `m=65536,t=3,p=1` on deployment host before launch. Never log raw
passwords/tokens.

- [ ] **Step 4: Verify auth behavior and session revocation**

Before verification, implement the configured transactional-email adapter in `email.rs`; tests use
an in-memory fake through the same trait. Implement `cleanup-auth-tokens --batch-size N` to delete
expired or consumed tokens in bounded `(expires_at,id)` order. Schedule it at least daily so
expired/consumed token cleanup completes within 24 hours.

Run: `cargo test -p cashmemo-api --test auth && cargo test -p cashmemo-api`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add v1/api/src/auth v1/api/migrations/0003_auth_constraints.sql v1/api/src/app.rs v1/api/src/config.rs v1/api/tests/auth.rs
git commit -m "feat: implement V1 authentication"
```

### Task 5: Implement Idempotent Onboarding and User Preferences

**Files:**

- Create: `v1/api/src/onboarding/{mod.rs,service.rs,routes.rs}`
- Create: `v1/api/migrations/0004_onboarding.sql`
- Modify: `v1/api/src/app.rs`
- Create: `v1/api/tests/onboarding.rs`

**Interfaces:**

- Produces `GET /api/v1/onboarding`, `PUT /api/v1/settings/preferences`,
  `POST /api/v1/onboarding/seed-categories`.
- Onboarding response derives `timezone_configured`, `default_currency_configured`,
  `categories_seeded`, and `has_active_wallet` from stored state.

- [ ] **Step 1: Write failing interrupted/repeated onboarding tests**

```rust
#[sqlx::test]
async fn category_seeding_is_idempotent(pool: PgPool) {
    seed_categories(&pool, user_id).await.unwrap();
    seed_categories(&pool, user_id).await.unwrap();
    assert_eq!(starter_category_count(&pool, user_id).await, EXPECTED_STARTER_COUNT);
}
```

Also reject invalid IANA timezones and unsupported default currencies.

- [ ] **Step 2: Run onboarding tests**

Run: `cargo test -p cashmemo-api --test onboarding`

Expected: FAIL.

- [ ] **Step 3: Implement backend-derived state and conflict-safe seeding**

Use immutable `starter_key` provenance and
`INSERT ... ON CONFLICT (user_id, starter_key) DO NOTHING`. Seeded and custom categories remain
ordinary user-owned categories in product behavior.

- [ ] **Step 4: Verify repeated and concurrent requests**

Run: `cargo test -p cashmemo-api --test onboarding`

Expected: PASS with one category per starter key.

- [ ] **Step 5: Commit**

```bash
git add v1/api/src/onboarding v1/api/migrations/0004_onboarding.sql v1/api/src/app.rs v1/api/tests/onboarding.rs
git commit -m "feat: add idempotent V1 onboarding"
```

### Task 6: Implement Wallet Lifecycle and Current Balances

**Files:**

- Create: `v1/api/src/wallets/{mod.rs,service.rs,routes.rs}`
- Modify: `v1/api/src/app.rs`
- Create: `v1/api/tests/wallets.rs`

**Interfaces:**

- Produces wallet CRUD/archive endpoints and `WalletBalance { currency, amount, as_of }`.
- Wallet currency is immutable; opening balance is wallet state, not synthetic income.

- [ ] **Step 1: Write failing wallet behavior and ownership tests**

Cover exact name limits, supported currency, opening balance, immutable currency, archive preserving
history, blocked destructive deletion with references, user isolation, and current balance formula
using only active transactions with `occurred_at <= now()`.

- [ ] **Step 2: Run wallet tests**

Run: `cargo test -p cashmemo-api --test wallets --test ownership`

Expected: FAIL.

- [ ] **Step 3: Implement scoped SQL and lifecycle rules**

```sql
SELECT w.opening_balance
     + COALESCE(SUM(CASE WHEN t.type='INCOME' THEN t.amount WHEN t.type='EXPENSE' THEN -t.amount END),0)
FROM wallets w
LEFT JOIN transactions t ON (t.user_id,t.wallet_id)=(w.user_id,w.id)
 AND t.deleted_at IS NULL AND t.occurred_at <= now()
WHERE w.user_id=$1 AND w.id=$2
GROUP BY w.id;
```

- [ ] **Step 4: Verify wallet tests**

Run: `cargo test -p cashmemo-api --test wallets --test ownership`

Expected: PASS; future and Trash transactions do not affect current balance.

- [ ] **Step 5: Commit**

```bash
git add v1/api/src/wallets v1/api/src/app.rs v1/api/tests/wallets.rs v1/api/tests/ownership.rs
git commit -m "feat: implement V1 wallets"
```

### Task 7: Implement Categories and Archive Semantics

**Files:**

- Create: `v1/api/src/categories/{mod.rs,service.rs,routes.rs}`
- Modify: `v1/api/src/app.rs`
- Create: `v1/api/tests/categories.rs`

**Interfaces:**

- Produces category list/create/rename/archive/restore endpoints.
- Active names use trimmed, Unicode case-insensitive comparison via stored `normalized_name`;
  existing transaction references survive archive.

- [ ] **Step 1: Write failing category tests**

Test expense/income kind, `1..=80` post-trim code points, normalized active-name uniqueness, rename,
archive/restore collision, ownership isolation, history references, and uniform seeded/custom
behavior.

- [ ] **Step 2: Run category tests**

Run: `cargo test -p cashmemo-api --test categories --test ownership`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic normalization and scoped mutations**

```rust
pub fn normalize_category_name(input: &str) -> Result<(String, String), ValidationError> {
    let display = input.trim();
    validate_code_points(display, 1, 80)?;
    Ok((display.to_owned(), display.to_lowercase()))
}
```

Use a partial unique index on `(user_id, kind, normalized_name) WHERE archived_at IS NULL`. Reject
archive only when it would make required new-entry selection impossible; never alter historical
transactions.

- [ ] **Step 4: Verify category tests**

Run: `cargo test -p cashmemo-api --test categories --test ownership`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add v1/api/src/categories v1/api/src/app.rs v1/api/tests/categories.rs v1/api/tests/ownership.rs
git commit -m "feat: implement V1 categories"
```

### Task 8: Implement Transactions, Trash, Restore, and Permanent Purge

**Files:**

- Create: `v1/api/src/transactions/{mod.rs,service.rs,routes.rs}`
- Modify: `v1/api/src/app.rs`
- Create: `v1/api/tests/transactions.rs`

**Interfaces:**

- Produces create/read/update, `DELETE /transactions/{id}`, `POST /transactions/{id}/restore`, and
  `DELETE /transactions/{id}/permanent`.
- Transaction direction comes from `INCOME | EXPENSE`; amount remains positive. Delete sets
  `deleted_at` and `purge_after`; restore clears both.

- [ ] **Step 1: Write failing transaction and lifecycle tests**

Cover exact money validation before SQL, wallet-derived currency, category kind, `0..=500` note code
points, current-local `occurred_at` default, edit preserving instant, duplicated `user_id` composite
ownership, 30-day Trash, restore, explicit permanent purge, budget/report exclusion, and cross-user
opaque `404` behavior.

```rust
assert_eq!(deleted.purge_after, deleted.deleted_at + Duration::days(30));
assert!(restored.deleted_at.is_none() && restored.purge_after.is_none());
```

- [ ] **Step 2: Run transaction tests**

Run: `cargo test -p cashmemo-api --test transactions --test ownership`

Expected: FAIL.

- [ ] **Step 3: Implement transaction service in SQL transactions**

Resolve authenticated user, wallet, category, currency exponent, and lifecycle state server-side.
Never trust client `user_id` or transaction currency. Updates validate both old and new scopes so
callers can invalidate affected aggregates.

- [ ] **Step 4: Add bounded Trash purge command**

`purge-trash --batch-size N` deletes only rows where
`deleted_at IS NOT NULL AND purge_after <= now()`, ordered by `(purge_after,id)`. Preserve any
`recurring_occurrences` row by nullable `generated_transaction_id` with `ON DELETE SET NULL`.

- [ ] **Step 5: Verify transaction lifecycle**

Run: `cargo test -p cashmemo-api --test transactions --test ownership`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add v1/api/src/transactions v1/api/src/app.rs v1/api/tests/transactions.rs v1/api/tests/ownership.rs
git commit -m "feat: implement V1 transaction lifecycle"
```

### Task 9: Implement History Filters, Literal Search, and Opaque Keyset Cursor

**Files:**

- Create: `v1/api/src/transactions/query.rs`
- Modify: `v1/api/src/transactions/routes.rs`
- Create: `v1/api/migrations/0005_history_indexes.sql`
- Create: `v1/api/tests/history.rs`

**Interfaces:**

- Produces `GET /api/v1/transactions?from=&to=&type=&wallet_id=&category_id=&q=&cursor=&limit=` and
  separate Trash query.
- Cursor payload: versioned, base64url JSON containing `occurred_at` and `id`; treated as untrusted
  input.

- [ ] **Step 1: Write failing query contract tests**

Test deterministic `(occurred_at DESC,id DESC)` traversal without gaps/duplicates, limit bounds,
malformed cursor rejection, tampered cursor preserving user scope, filters, future-dated visibility,
literal case-insensitive substring matching, escaped `%`, `_`, and `\\`, `q` length, and
active/Trash separation.

- [ ] **Step 2: Run history tests**

Run: `cargo test -p cashmemo-api --test history`

Expected: FAIL.

- [ ] **Step 3: Implement validated cursor and escaped `ILIKE` query**

```rust
fn escape_like(q: &str) -> String {
    q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}
```

Use `ILIKE '%' || $q || '%' ESCAPE '\\'`. Add only
`(user_id, occurred_at DESC, id DESC) WHERE deleted_at IS NULL` and
`(user_id, purge_after) WHERE deleted_at IS NOT NULL`; add measured filter indexes later only with
query-plan evidence.

- [ ] **Step 4: Verify history queries against realistic fixtures**

Run: `cargo test -p cashmemo-api --test history`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add v1/api/src/transactions/query.rs v1/api/src/transactions/routes.rs v1/api/migrations/0005_history_indexes.sql v1/api/tests/history.rs
git commit -m "feat: add V1 transaction history queries"
```

### Task 10: Implement Monthly Category Budgets

**Files:**

- Create: `v1/api/src/budgets/{mod.rs,service.rs,routes.rs}`
- Modify: `v1/api/src/app.rs`
- Create: `v1/api/tests/budgets.rs`

**Interfaces:**

- Produces monthly budget CRUD and `GET /api/v1/reports/budgets?month=YYYY-MM`.
- Budget uniqueness: `(user_id, category_id, currency, month)`; `month` is calendar `DATE`
  constrained to first day.

- [ ] **Step 1: Write failing budget calculation tests**

Cover category/currency match, current-user timezone month boundaries, expense-only spending,
active-only transactions, create/edit/delete/restore movement between months/categories/wallet
currencies, overspending, and exact decimal progress calculation without persisted totals.

- [ ] **Step 2: Run budget tests**

Run: `cargo test -p cashmemo-api --test budgets`

Expected: FAIL.

- [ ] **Step 3: Implement derived budget queries**

Convert requested local month start/end to UTC instants once, then aggregate active expense
transactions in matching category and currency. Return decimal strings for `budgeted`, `spent`, and
`remaining`; return percentage as a presentation-safe decimal string, not floating point.

- [ ] **Step 4: Verify all mutation recalculation cases**

Run: `cargo test -p cashmemo-api --test budgets`

Expected: PASS for create, edit, Trash, restore, and permanent purge.

- [ ] **Step 5: Commit**

```bash
git add v1/api/src/budgets v1/api/src/app.rs v1/api/tests/budgets.rs
git commit -m "feat: implement monthly category budgets"
```

### Task 11: Implement Recurring Rules and Idempotent Bounded Processing

**Files:**

- Create: `v1/api/src/recurring/{mod.rs,service.rs,processor.rs,routes.rs}`
- Create: `v1/api/migrations/0006_recurring_constraints.sql`
- Modify: `v1/api/src/app.rs`
- Create: `v1/api/tests/recurring.rs`

**Interfaces:**

- Produces recurring rule CRUD, pause/resume, and CLI
  `process-recurring --batch-size N --max-occurrences-per-rule N`.
- `recurring_occurrences` is immutable idempotency history with unique
  `(recurring_rule_id, scheduled_for)` and at most one nullable generated transaction link.

- [ ] **Step 1: Write failing cadence and idempotency tests**

Cover daily/weekly/monthly/yearly local dates, month-end clamping, leap year, past `start_date`
selecting first cadence date on/after current local date without historical backfill, bounded
post-activation catch-up, pause/resume, timezone change affecting only future conversion, concurrent
workers, repeated runs, Trash/permanent transaction deletion not regenerating occurrence, and
cross-user ownership.

- [ ] **Step 2: Run recurring tests**

Run: `cargo test -p cashmemo-api --test recurring`

Expected: FAIL.

- [ ] **Step 3: Implement rule lifecycle and date calculator**

```rust
pub enum Cadence { Daily, Weekly, Monthly, Yearly }
pub fn first_due_on_or_after(start: NaiveDate, today: NaiveDate, cadence: Cadence) -> NaiveDate;
pub fn next_due(after: NaiveDate, anchor_day: u32, cadence: Cadence) -> NaiveDate;
```

Generated transaction is ordinary after creation. Editing a rule never rewrites prior occurrence or
transaction rows.

- [ ] **Step 4: Implement atomic occurrence generation**

Within one DB transaction, claim due rules with `FOR UPDATE SKIP LOCKED`, insert occurrence with
`ON CONFLICT DO NOTHING`, insert at most one transaction for newly inserted occurrence, and advance
`next_due_date`. Stop at both global batch size and per-rule bound; later runs continue catch-up.

- [ ] **Step 5: Verify concurrency and retry behavior**

Run: `cargo test -p cashmemo-api --test recurring`

Expected: PASS; every scheduled local date has one occurrence and at most one generated transaction.

- [ ] **Step 6: Commit**

```bash
git add v1/api/src/recurring v1/api/migrations/0006_recurring_constraints.sql v1/api/src/app.rs v1/api/tests/recurring.rs
git commit -m "feat: add idempotent recurring transactions"
```

### Task 12: Implement Currency-Separated Dashboard Reporting

**Files:**

- Create: `v1/api/src/reporting/{mod.rs,query.rs,routes.rs}`
- Modify: `v1/api/src/app.rs`
- Create: `v1/api/tests/reporting.rs`

**Interfaces:**

- Produces three purpose-built reads: `/api/v1/reports/monthly-summary`,
  `/api/v1/reports/budget-summary`, `/api/v1/transactions/recent`.
- Monthly summary groups by currency and returns income, expense, net, and expense-category
  breakdown.

- [ ] **Step 1: Write failing reporting tests**

Test exact income/expense/net, category aggregation, multiple currencies as separate groups, current
timezone boundaries, Trash exclusion, future transaction exclusion from current balance but
inclusion in history, and recurring templates excluded until a transaction exists.

- [ ] **Step 2: Run reporting tests**

Run: `cargo test -p cashmemo-api --test reporting --test budgets`

Expected: FAIL.

- [ ] **Step 3: Implement read/query composition**

Keep calculations in SQL/Rust query composition. Do not create a second domain/business layer or
persist aggregate totals. Require explicit `month=YYYY-MM`; derive current month in server-owned
user timezone when omitted.

- [ ] **Step 4: Verify reporting suite**

Run: `cargo test -p cashmemo-api --test reporting --test budgets --test transactions`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add v1/api/src/reporting v1/api/src/app.rs v1/api/tests/reporting.rs
git commit -m "feat: add V1 monthly reporting"
```

### Task 13: Implement Pending Deletion, Atomic Purge Claim, and Anti-Resurrection Receipts

**Files:**

- Create: `v1/api/src/accounts/{mod.rs,deletion.rs,routes.rs}`
- Create: `v1/api/migrations/0007_account_deletion.sql`
- Modify: `v1/api/src/auth/{model.rs,service.rs,routes.rs}`
- Modify: `v1/api/src/{app.rs,config.rs,main.rs}`
- Create: `v1/api/tests/account_deletion.rs`

**Interfaces:**

- Produces request/status/cancel endpoints and access states `active`, `pending_deletion`,
  `purging`.
- Produces `DeletionReceiptSink::create_receipt(HmacUserId, purged_at, key_version)` available only
  to purge command configuration, not API serving configuration.

- [ ] **Step 1: Write failing lifecycle and race tests**

Cover recent password requirement, transactional session revocation, seven-day grace, deletion-only
login after correct credentials, allowed status/cancel/logout only, password reset remaining
unauthenticated and not cancelling deletion, atomic pending-to-purging claim, failed cancel after
claim, two-worker single claim, failed receipt keeping live data and retryable purging state,
receipt-before-delete, and full live-data cascade.

- [ ] **Step 2: Run account deletion tests**

Run: `cargo test -p cashmemo-api --test account_deletion --test auth`

Expected: FAIL.

- [ ] **Step 3: Implement request/cancel and restricted session access**

Normal app middleware rejects `DeletionOnly`; only `GET /account/deletion`,
`POST /account/deletion/cancel`, and `POST /auth/logout` accept it. Login reveals pending/purging
state only after successful password verification. Cancellation atomically updates only
`pending_deletion` rows.

- [ ] **Step 4: Implement bounded purge claim and durable receipt ordering**

```sql
UPDATE users SET status='purging', purge_started_at=now()
WHERE id=(SELECT id FROM users WHERE status='pending_deletion' AND deletion_due_at<=now()
          ORDER BY deletion_due_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id,purge_started_at;
```

After claim, create HMAC receipt in external ledger. If receipt fails, commit no live-data delete;
retain `purging` for retry. If receipt succeeds, delete live data and user in a DB transaction.
Ledger stores only `HMAC(user_id)`, `purged_at`, and key version; secret stays outside application
DB/backups. Restored databases remain isolated until receipt replay.

- [ ] **Step 5: Verify races and failures**

Run: `cargo test -p cashmemo-api --test account_deletion --test auth`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add v1/api/src/accounts v1/api/src/auth v1/api/src/app.rs v1/api/src/config.rs v1/api/src/main.rs v1/api/migrations/0007_account_deletion.sql v1/api/tests/account_deletion.rs
git commit -m "feat: implement safe account deletion"
```

### Task 14: Generate OpenAPI and Establish Orval Contract Drift Gate

**Files:**

- Create: `v1/api/src/{openapi.rs,bin/export_openapi.rs}`
- Modify: `v1/api/src/lib.rs`
- Create: `openapi/cashmemo-v1.json`
- Create: `v1/web/{package.json,orval.config.ts}`
- Create: `v1/web/lib/api/axios.ts`
- Create: `v1/web/generated/api/.gitkeep`
- Modify: `package.json`, `pnpm-workspace.yaml`

**Interfaces:**

- Produces deterministic OpenAPI from Rust `utoipa` schemas and generated TypeScript Axios/TanStack
  Query client under `v1/web/generated/api/`.
- Generated files are committed, never manually edited, and regenerated by `pnpm v1:api:generate`.

- [ ] **Step 1: Add failing deterministic-generation checks**

Commands compare a fresh Rust export and Orval output with Git worktree:

```json
{
  "scripts": {
    "v1:openapi": "cargo run -p cashmemo-api --bin export_openapi -- openapi/cashmemo-v1.json",
    "v1:api:generate": "pnpm v1:openapi && pnpm --dir v1/web orval",
    "v1:api:check": "pnpm v1:api:generate && git diff --exit-code -- openapi/cashmemo-v1.json v1/web/generated/api"
  }
}
```

- [ ] **Step 2: Run generation and confirm absent schema/client**

Run: `pnpm v1:api:generate`

Expected: FAIL until `ApiDoc`, operation IDs, and Orval config exist.

- [ ] **Step 3: Annotate routes/schemas and configure Orval**

Use stable operation IDs. Configure Axios instance with credentials, normalized error envelope, and
`/api/v1` base URL. Zod remains UX validation only; Rust contract remains authoritative.

- [ ] **Step 4: Generate and verify drift check**

Run: `pnpm v1:api:check`

Expected: PASS with no diff after a second generation.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml v1/api/src/openapi.rs v1/api/src/bin/export_openapi.rs v1/api/src/lib.rs openapi/cashmemo-v1.json v1/web
git commit -m "build: generate V1 API client from Rust"
```

### Task 15: Build Next.js Shell, No-Store Boundary, Public Auth, and PWA Assets

**Files:**

- Create:
  `v1/web/{next.config.ts,tsconfig.json,postcss.config.mjs,vitest.config.ts,playwright.config.ts}`
- Create: `v1/web/app/{layout.tsx,page.tsx,manifest.ts,globals.css}`
- Create:
  `v1/web/app/(public)/{login,register,verify-email,forgot-password,reset-password}/page.tsx`
- Create: `v1/web/app/(auth)/layout.tsx`, `v1/web/app/(auth)/app/layout.tsx`
- Create: `v1/web/app/(auth)/deletion/page.tsx`
- Create: `v1/web/components/app-shell/{app-shell.tsx,bottom-nav.tsx,sidebar.tsx}`
- Create: `v1/web/components/ui/{button.tsx,dialog.tsx,form-field.tsx,input.tsx}`
- Create: `v1/web/features/auth/{forms.tsx,use-session.ts}`
- Create: `v1/web/lib/{auth/session.ts,query/provider.tsx,validation/auth.ts}`
- Create: `v1/web/public/{sw.js,icons/icon-192.png,icons/icon-512.png}`
- Create: `v1/web/tests/{auth,cache-policy}.spec.tsx`

**Interfaces:**

- Produces public/authenticated route guards, TanStack Query provider, React Hook Form + Zod auth
  forms, and deletion-only routing.
- Service worker caches only versioned public static assets and never authenticated page/RSC/API
  responses.

- [ ] **Step 1: Write failing auth-route and cache-policy tests**

Test first visit, registration success, verification states, login, forgot/reset, pending-deletion
routing/actions, safe internal return paths excluding action/destructive URLs, logout clearing
QueryClient, `no-store` Next fetches, and static-only service worker allowlist.

```ts
expect(isSafeReturnPath("/app/history")).toBe(true);
expect(isSafeReturnPath("//evil.example")).toBe(false);
expect(isSafeReturnPath("/app/settings/delete-account")).toBe(false);
```

- [ ] **Step 2: Run frontend tests**

Run: `pnpm --dir v1/web test --run`

Expected: FAIL because app shell and auth features are absent.

- [ ] **Step 3: Implement single authenticated shell and auth flows**

Use generated hooks for mutations/queries. Do not persist server state. Set authenticated Next
routes dynamic/no-store; clear TanStack cache on logout/session expiry before safe navigation.
Deletion screen exposes only status, cancel when still pending, and sign out.

- [ ] **Step 4: Implement static-only PWA registration**

`sw.js` rejects non-GET, `/api/`, RSC, document, and authenticated route requests from cache
handling; only explicit hashed JS/CSS/font/icon/manifest/public-brand assets use cache-first. No
offline financial write queue.

- [ ] **Step 5: Verify lint, types, tests, and build**

Run:
`pnpm --dir v1/web lint && pnpm --dir v1/web typecheck && pnpm --dir v1/web test --run && pnpm --dir v1/web build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add v1/web
git commit -m "feat: add V1 web shell and authentication"
```

### Task 16: Build Derived Onboarding, Wallet, and Category UX

**Files:**

- Create: `v1/web/app/(auth)/onboarding/page.tsx`
- Create: `v1/web/app/(auth)/app/wallets/page.tsx`
- Create: `v1/web/app/(auth)/app/categories/page.tsx`
- Create: `v1/web/features/onboarding/{onboarding-flow.tsx,use-onboarding.ts}`
- Create: `v1/web/features/wallets/{wallet-form.tsx,wallet-list.tsx}`
- Create: `v1/web/features/categories/{category-form.tsx,category-list.tsx}`
- Create: `v1/web/lib/validation/{wallet.ts,category.ts}`
- Create: `v1/web/tests/{onboarding,wallets,categories}.spec.tsx`

**Interfaces:**

- Consumes generated onboarding, wallet, category hooks.
- Produces first-wallet flow and management screens with active/archive views.

- [ ] **Step 1: Write failing UX tests**

Test interrupted/repeated onboarding, timezone/default currency selection, starter category seeding,
empty state, first wallet, exact mirrored text limits without truncation, immutable wallet currency
messaging, archive confirmation, category rename/archive/reference behavior, and seeded/custom
uniform display.

- [ ] **Step 2: Run focused component tests**

Run:
`pnpm --dir v1/web vitest run tests/onboarding.spec.tsx tests/wallets.spec.tsx tests/categories.spec.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement route screens and shared forms**

Derive onboarding progress from API state rather than frontend workflow flags. Use React Hook Form
for forms, Zod only for immediate limits/shape, and generated API errors for authority. Every screen
implements goal, primary action, required info, empty/loading/error/success states, and mobile
behavior from spec Section 24.6.

- [ ] **Step 4: Verify frontend gates**

Run:
`pnpm --dir v1/web lint && pnpm --dir v1/web typecheck && pnpm --dir v1/web vitest run tests/onboarding.spec.tsx tests/wallets.spec.tsx tests/categories.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add v1/web/app v1/web/features/onboarding v1/web/features/wallets v1/web/features/categories v1/web/lib/validation v1/web/tests
git commit -m "feat: add V1 onboarding and organization UX"
```

### Task 17: Build Route-Driven Transaction Entry, History, and Trash UX

**Files:**

- Create: `v1/web/app/(auth)/app/transactions/{page.tsx,new/page.tsx,[id]/page.tsx,trash/page.tsx}`
- Create: `v1/web/features/transactions/{form.tsx,history.tsx,filters.tsx,trash.tsx,query-keys.ts}`
- Create: `v1/web/lib/validation/transaction.ts`
- Create: `v1/web/tests/{transaction-form,history,trash}.spec.tsx`

**Interfaces:**

- Consumes generated transaction/history hooks.
- Produces canonical `/app/transactions/new` entry route, URL-owned filters, explicit `Load more`,
  edit/delete/restore/permanent-delete UI.

- [ ] **Step 1: Write failing fast-entry and currency tests**

Test expense default, income switch, visually first amount, sole-wallet preselection, last-used
active wallet from server, required wallet fallback, currency exponent validation, wallet-change
preservation/error without amount mutation, local-now default, optional date adjustment, edit
preserving instant, note limit, and targeted invalidation of old/new month/wallet/category scopes.

- [ ] **Step 2: Write failing history/Trash tests**

Test URL filters, literal search, chronological list, explicit `Load more`, recoverable page error,
row detail/edit, confirmed delete, server-confirmed removal, Undo invoking restore endpoint,
restore, explicit permanent-delete confirmation, and purge date display.

- [ ] **Step 3: Run tests and confirm missing UI**

Run:
`pnpm --dir v1/web vitest run tests/transaction-form.spec.tsx tests/history.spec.tsx tests/trash.spec.tsx`

Expected: FAIL.

- [ ] **Step 4: Implement one route-driven form and targeted query keys**

Mobile uses focused full page. Desktop may present same routed component as dialog only after
deep-link, refresh, back, focus restoration, and direct navigation tests pass; otherwise keep normal
page. Never optimistically invent balances, budget totals, income, expense, or net. Safe pending
state/toast/confirmed row removal remains allowed.

- [ ] **Step 5: Implement URL history and explicit Load more**

Store `from`, `to`, `type`, `wallet`, `category`, and `q` in URL search params. Cursor remains
internal to query pages. Escape semantics stay server-owned. Keep future-dated transactions visible
with a clear future label.

- [ ] **Step 6: Verify transaction UI**

Run:
`pnpm --dir v1/web lint && pnpm --dir v1/web typecheck && pnpm --dir v1/web vitest run tests/transaction-form.spec.tsx tests/history.spec.tsx tests/trash.spec.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add v1/web/app v1/web/features/transactions v1/web/lib/validation/transaction.ts v1/web/tests
git commit -m "feat: add V1 transaction UX"
```

### Task 18: Build Dashboard, Budgets, Recurring Rules, and Settings UX

**Files:**

- Create: `v1/web/app/(auth)/app/{page.tsx,budgets/page.tsx,recurring/page.tsx,settings/page.tsx}`
- Create: `v1/web/app/(auth)/app/settings/{sessions,delete-account}/page.tsx`
- Create: `v1/web/features/dashboard/{dashboard.tsx,monthly-summary.tsx,recent-transactions.tsx}`
- Create: `v1/web/features/budgets/{budget-form.tsx,budget-list.tsx,budget-progress.tsx}`
- Create: `v1/web/features/recurring/{recurring-form.tsx,recurring-list.tsx}`
- Create:
  `v1/web/features/settings/{preferences-form.tsx,session-controls.tsx,account-deletion.tsx}`
- Create: `v1/web/components/money/{amount.tsx,currency-group.tsx}`
- Create: `v1/web/tests/{dashboard,budgets,recurring,settings}.spec.tsx`

**Interfaces:**

- Consumes three dashboard reads, budget CRUD/summary, recurring CRUD/pause/resume,
  preference/session/account-deletion APIs.
- Produces currency-separated monthly understanding and account/session controls.

- [ ] **Step 1: Write failing dashboard and budget tests**

Test empty dashboard, income/expense/net by currency, category breakdown, budget
progress/overspending without color-only meaning, recent transactions, partial endpoint failures,
month selection, budget creation, and authoritative post-mutation totals.

- [ ] **Step 2: Write failing recurring/settings tests**

Test daily/weekly/monthly/yearly form, next-date explanation, create/edit, pause/resume, upcoming
rules excluded from financial totals/history, timezone/default currency semantics, current/all
session logout, recent-password account deletion, grace/backup wording, and deletion-only
transition.

- [ ] **Step 3: Run focused tests**

Run:
`pnpm --dir v1/web vitest run tests/dashboard.spec.tsx tests/budgets.spec.tsx tests/recurring.spec.tsx tests/settings.spec.tsx`

Expected: FAIL.

- [ ] **Step 4: Implement purpose-built screens with thin calculations**

Format server decimal strings for display but do not recompute currency, budget, balance,
recurrence, or lifecycle rules in React. Use a small number of queries: monthly summary, budget
summary, recent transactions. Isolate endpoint errors without issuing one request per card.

- [ ] **Step 5: Verify frontend unit gates**

Run:
`pnpm --dir v1/web lint && pnpm --dir v1/web typecheck && pnpm --dir v1/web test --run && pnpm --dir v1/web build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add v1/web/app v1/web/features/dashboard v1/web/features/budgets v1/web/features/recurring v1/web/features/settings v1/web/components/money v1/web/tests
git commit -m "feat: complete V1 financial journal UX"
```

### Task 19: Add Accessibility and Critical Browser Acceptance Gates

**Files:**

- Create:
  `v1/web/e2e/{auth-onboarding,transactions,history-trash,budgets-recurring,account-deletion,cache-isolation}.spec.ts`
- Create: `v1/web/tests/accessibility.spec.tsx`
- Modify: `v1/web/playwright.config.ts`
- Modify: `v1/web/app/(auth)/app/layout.tsx`
- Modify: `v1/web/components/app-shell/{app-shell.tsx,bottom-nav.tsx,sidebar.tsx}`
- Modify: `v1/web/features/transactions/{form.tsx,history.tsx,trash.tsx}`
- Modify:
  `v1/web/features/{dashboard/dashboard.tsx,budgets/budget-progress.tsx,recurring/recurring-form.tsx,settings/account-deletion.tsx}`

**Interfaces:**

- Produces executable acceptance evidence for major spec flows against real Rust API and PostgreSQL.

- [ ] **Step 1: Write failing critical browser flows**

Create isolated users and cover first visit → register → verify → login → onboarding → first wallet;
add expense/income; filter/edit/delete/restore; budget update; recurring pause/resume; session
revoke; pending deletion cancel. Add a two-user browser/API assertion proving no cross-user
read/mutation/inference.

- [ ] **Step 2: Add failing accessibility assertions**

Assert visible focus, logical headings, linked form errors, practical touch targets, keyboard
operation, modal focus trap/restoration, reduced motion, and text/icon meaning independent of
red/green color.

- [ ] **Step 3: Run E2E and accessibility suites**

Run:
`pnpm --dir v1/web playwright test && pnpm --dir v1/web vitest run tests/accessibility.spec.tsx`

Expected: FAIL at first unmet behavior or accessibility contract.

- [ ] **Step 4: Make smallest UI corrections until gates pass**

Change only observed failures. Do not add alternate flows, analytics, or speculative components.

- [ ] **Step 5: Verify complete web suite**

Run:
`pnpm --dir v1/web lint && pnpm --dir v1/web typecheck && pnpm --dir v1/web test --run && pnpm --dir v1/web playwright test && pnpm --dir v1/web build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add v1/web
git commit -m "test: verify V1 browser acceptance flows"
```

### Task 20: Package Runtime, Scheduled Commands, Health, and Same-Origin Routing

**Files:**

- Create: `infra/v1/{api.Dockerfile,web.Dockerfile,dokploy-compose.yml,env.example,traefik.md}`
- Modify: `v1/api/src/{app.rs,config.rs,main.rs}`
- Create: `v1/api/tests/operations.rs`
- Create: `docs/operations/v1-deployment.md`

**Interfaces:**

- Produces two long-running services (`cashmemo-v1-web`, `cashmemo-v1-api`), one V1 PostgreSQL
  target, explicit migrate command, and Dokploy schedules using API image commands.
- Produces `/health` process liveness and `/ready` dependency readiness.

- [ ] **Step 1: Write failing operations tests**

Test health without DB dependency, readiness failure on DB loss, graceful shutdown, structured
request status/latency/request ID fields, content-minimizing logs, config fail-fast, bounded job
summaries, and absence of password/token/note/financial payload logging.

- [ ] **Step 2: Run operations tests**

Run: `cargo test -p cashmemo-api --test operations`

Expected: FAIL.

- [ ] **Step 3: Implement runtime and config boundary**

Application env includes only `V1_DATABASE_URL`, `PUBLIC_ORIGIN`, `COOKIE_SECURE`, session
durations, `EMAIL_*`, `APP_ENV`, `LOG_LEVEL`, and auth rate-limit thresholds. Backup credentials
never enter web/API config. Purge command alone receives deletion-ledger credentials.

- [ ] **Step 4: Create proportional containers and Dokploy commands**

Use multi-stage, non-root runtime images without build tools. Configure same-origin Traefik routes:
`/*` → web, `/api/v1/*` → API. Schedule bounded `process-recurring`, `purge-trash`,
`purge-accounts`, and `cleanup-auth-tokens`; make `migrate` explicit one-shot. Add resource limits
and graceful termination. Mark read-only root FS, SBOM retention, digest pinning, and scanner
integration best-effort where existing workflow supports them; always record deployed digest.

- [ ] **Step 5: Verify images/config without deployment**

Run:
`docker compose -f infra/v1/dokploy-compose.yml config && docker build -f infra/v1/api.Dockerfile . && docker build -f infra/v1/web.Dockerfile .`

Expected: PASS; compose defines no permanent jobs/migrate service and uses distinct V1 DB
configuration.

- [ ] **Step 6: Commit**

```bash
git add infra/v1 v1/api/src v1/api/tests/operations.rs docs/operations/v1-deployment.md
git commit -m "ops: package Cashmemo V1 runtime"
```

### Task 21: Define Backup, Restore, Preservation, and Anti-Resurrection Operations

**Files:**

- Create: `infra/backup/pgbackrest.conf.example`
- Create: `infra/backup/restore-runbook.md`
- Create: `scripts/{preservation-audit.sh,verify-restore.sh}`
- Create: `docs/operations/{preservation-gate.md,backup-recovery.md,rollback.md}`
- Create: `tests/operations/{preservation-gate.bats,restore-drill.bats}`

**Interfaces:**

- Produces operator evidence templates for preservation decision, backup freshness, restore/PITR
  drill, deletion receipt replay, production readiness, and rollback/reconciliation.

- [ ] **Step 1: Write failing shell contract tests**

Test that preservation audit requires operator identity, Dokploy service/config inventory, actual DB
identification, table/row evidence, backup inventory/freshness, real-data decision, and approval
record. Test migration/deploy wrapper refuses missing evidence for production replacement but
permits explicitly disposable isolated V1 development/staging targets.

- [ ] **Step 2: Run operations contract tests**

Run: `bats tests/operations/preservation-gate.bats tests/operations/restore-drill.bats`

Expected: FAIL because scripts/runbooks are absent.

- [ ] **Step 3: Implement preservation audit and fail-closed gates**

Gate applies before destructive legacy-data action, production-target migration, production
replacement deployment, or production route cutover. If real user data exists, output
`STOP_REQUIRES_DEDICATED_MIGRATION_PLAN` and perform no destructive/replacement action. Never infer
approval from repository state.

- [ ] **Step 4: Define pgBackRest and restore verification exactly**

Document weekly full, daily differential, continuous WAL archive, encrypted external S3-compatible
repository, backup freshness alert, and monthly isolated restore/PITR drill. Require
implementation-time values for `repo1-retention-full`, `repo1-retention-full-type`, differential
override if used, and archive/WAL retention. Treat RPO/RTO as targets until drills prove them.
Deletion receipts expire only after proving no restorable pre-purge backup remains plus seven-day
safety margin; key rotation preserves all unexpired receipt evaluation.

- [ ] **Step 5: Define rollback constraints**

Keep previous image digest, config, routing, and database recoverable through production
verification. Once V1 accepts real writes, forbid silent routing to stale legacy; preserve both
states and require explicit reconciliation procedure/operator decision.

- [ ] **Step 6: Verify scripts and documentation links**

Run:
`bats tests/operations/preservation-gate.bats tests/operations/restore-drill.bats && pnpm exec prettier --check docs/operations infra/backup`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add infra/backup scripts/preservation-audit.sh scripts/verify-restore.sh docs/operations tests/operations
git commit -m "ops: define V1 preservation and recovery gates"
```

### Task 22: Add V1 CI Quality and Security Gates

**Files:**

- Create: `.github/workflows/v1-ci.yml`
- Modify: `package.json`
- Create: `docs/operations/ci-gates.md`

**Interfaces:**

- Produces required checks for Rust, PostgreSQL integration, frontend, OpenAPI drift, E2E, migration
  safety, containers, and focused dependency/container scans.

- [ ] **Step 1: Add a local aggregate verification command**

```json
{
  "scripts": {
    "v1:verify": "pnpm v1:api:check && cargo fmt --check && cargo clippy -p cashmemo-api --all-targets -- -D warnings && cargo test -p cashmemo-api && pnpm --dir v1/web lint && pnpm --dir v1/web typecheck && pnpm --dir v1/web test --run && pnpm --dir v1/web build"
  }
}
```

- [ ] **Step 2: Run aggregate gate and capture first real failure**

Run: `pnpm v1:verify`

Expected: PASS for completed V1 tasks; any failure blocks CI addition until fixed in owning task.

- [ ] **Step 3: Implement GitHub Actions jobs**

Use PostgreSQL service container and isolated V1 DB. Jobs: Rust
format/clippy/unit/integration/build; frontend lint/typecheck/test/build; OpenAPI/Orval drift;
Playwright critical suite; migration empty/identified/unknown-target checks; Docker builds;
existing-compatible dependency/container scanning. Do not make legacy TS7053 cleanup a V1 gate.

- [ ] **Step 4: Validate workflow syntax and local gates**

Run:
`pnpm v1:verify && pnpm --dir v1/web playwright test && docker compose -f infra/v1/dokploy-compose.yml config`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/v1-ci.yml package.json docs/operations/ci-gates.md
git commit -m "ci: add Cashmemo V1 quality gates"
```

### Task 23: Run V1 Verification and Record Merge/Production Readiness Separately

**Files:**

- Create: `docs/verification/v1-acceptance.md`
- Create: `docs/verification/v1-security-audit.md`
- Create: `docs/verification/v1-merge-readiness.md`
- Create: `docs/verification/v1-production-readiness.md`
- Modify: `README.md`

**Interfaces:**

- Produces immutable evidence links/checksums for branch verification; does not deploy, merge,
  migrate production, or switch routes.

- [ ] **Step 1: Run clean V1 verification**

Run:
`pnpm install --frozen-lockfile && cargo clean && pnpm v1:verify && pnpm --dir v1/web playwright test`

Expected: PASS.

- [ ] **Step 2: Run security and database audit cases**

Run:
`cargo test -p cashmemo-api --test ownership --test auth --test account_deletion --test recurring --test migrations`

Expected: PASS for cross-user isolation, session revocation, money exactness, recurrence
idempotency, purge races, and migration target protection.

- [ ] **Step 3: Record merge-ready evidence**

Record commit SHA and outputs for approved scope, CI, E2E, ownership/security, clean migrations,
canonical-structure preparation, docs, and preservation decision status. A real-data discovery must
reference a separately approved migration spec/plan before Task 24 may remove legacy migration
material.

- [ ] **Step 4: Record production-cutover inputs separately**

Document actual environment audit, migration requirement/result, recent usable backup, restore
verification, deployment config, legacy image/config digest, V1 production DB preparation,
smoke/rollback steps, and operator approval. Mark absent production evidence as not-ready without
blocking a safe repository merge when preservation decision allows it.

- [ ] **Step 5: Commit verification evidence**

```bash
git add docs/verification README.md
git commit -m "docs: record Cashmemo V1 verification"
```

### Task 24: Promote V1 to Canonical Repository and Remove Legacy Application

**Files:**

- Move: `v1/api` → `apps/api`
- Move: `v1/web` → `apps/web`
- Modify: `Cargo.toml`, `package.json`, `pnpm-workspace.yaml`, `openapi/cashmemo-v1.json`
- Modify: `.github/workflows/v1-ci.yml`,
  `infra/v1/{api.Dockerfile,web.Dockerfile,dokploy-compose.yml,env.example,traefik.md}`, `README.md`
- Modify:
  `docs/operations/{v1-deployment.md,preservation-gate.md,backup-recovery.md,rollback.md,ci-gates.md}`
- Remove: legacy `apps/server`, legacy `apps/web` before V1 promotion, `packages/contracts`,
  `packages/currency-registry`, `packages/domain`, `packages/privacy-rules`, and
  `packages/test-support` after exact preservation/reuse audit
- Remove: obsolete legacy workflows, Docker/Dokploy configuration, routes, and excluded
  AI/voice/draft/export code named by the Task 24 inventory
- Preserve: legacy migration/history files named by the recorded preservation decision

**Interfaces:**

- Produces exact repository state intended for `main`: one Cashmemo V1 web app, one Rust API,
  isolated approved schema history, current operations docs, no permanent dual-app structure.

- [ ] **Step 1: Re-check Task 23 and preservation prerequisites**

Run:
`test -f docs/verification/v1-merge-readiness.md && scripts/preservation-audit.sh --check-recorded-decision`

Expected: PASS. If output is `STOP_REQUIRES_DEDICATED_MIGRATION_PLAN`, stop this task; do not remove
legacy code or migrations.

- [ ] **Step 2: Move V1 paths and update all references mechanically**

Move legacy `apps/web` aside only within this reviewed removal transaction, then use
`git mv v1/api apps/api` and `git mv v1/web apps/web`. Update workspace members; rename root scripts
`v1:openapi` → `openapi`, `v1:api:generate` → `api:generate`, `v1:api:check` → `api:check`, and
`v1:verify` → `verify`; then update CI, Docker contexts, Orval output, docs, and commands. Keep API
route prefix `/api/v1` unchanged.

- [ ] **Step 3: Remove legacy implementation after exact inventory review**

Generate `git ls-files` inventory, mark each legacy path against REUSE/ADAPT/REPLACE/REMOVE
assessment, then remove only approved legacy app code, old API contracts, excluded
AI/voice/draft/export paths, and obsolete CI/runtime config. Keep reusable branding/assets and
infrastructure patterns already incorporated. Do not delete legacy migrations required by the
preservation decision.

- [ ] **Step 4: Add clean-repository boundary test**

Create `tests/repository/canonical-layout.bats` asserting `apps/api`, `apps/web`, current
OpenAPI/client paths exist; temporary `v1/` and legacy executable entrypoints do not; workspace
manifests and CI reference only canonical apps; excluded V1 dependencies/routes are absent.

- [ ] **Step 5: Run complete canonical verification**

Run:
`pnpm install --frozen-lockfile && cargo clean && pnpm api:check && cargo fmt --check && cargo clippy -p cashmemo-api --all-targets -- -D warnings && cargo test -p cashmemo-api && pnpm --dir apps/web lint && pnpm --dir apps/web typecheck && pnpm --dir apps/web test --run && pnpm --dir apps/web playwright test && pnpm --dir apps/web build && bats tests/repository/canonical-layout.bats`

Expected: PASS from clean repository state.

- [ ] **Step 6: Commit canonical replacement**

```bash
git add -A
git commit -m "refactor: replace legacy Cashmemo with V1"
```

### Task 25: Final Branch Review Gate—No Merge or Deployment

**Files:**

- Modify: `docs/verification/v1-merge-readiness.md`
- Modify: `docs/verification/v1-production-readiness.md`
- Create: `docs/verification/v1-final-review.md`

**Interfaces:**

- Produces reviewed branch handoff for PR/merge decision and separate later production-cutover
  runbook.

- [ ] **Step 1: Verify branch diff and repository status**

Run:
`git diff --check new-cashmemo...HEAD && git status --short --branch && git log --oneline new-cashmemo..HEAD`

Expected: no whitespace errors or uncommitted files; commit series remains reviewable.

- [ ] **Step 2: Re-run merge-ready gates**

Run:
`pnpm verify && pnpm --dir apps/web playwright test && bats tests/repository/canonical-layout.bats`

Expected: PASS.

- [ ] **Step 3: Review merge-ready checklist**

Confirm approved scope implemented, CI/E2E/security green, clean migrations verified, preservation
decision resolved enough for safe merge, canonical structure complete, legacy app removed, required
migration history retained, docs current, and no production-blocking design issue hidden.

- [ ] **Step 4: Review production-cutover checklist without executing it**

Confirm readiness record separately covers actual environment audit, migration if required, fresh
backup, restore drill, deployment config, recorded legacy image/config, V1 production DB,
smoke/rollback/reconciliation, and operator approval. Do not make route switch prerequisite for
branch merge.

- [ ] **Step 5: Commit final review evidence**

```bash
git add docs/verification
git commit -m "docs: finalize Cashmemo V1 review evidence"
```

- [ ] **Step 6: Stop for human merge review**

Do not merge, deploy, migrate production, modify routing, or retire legacy infrastructure.
Human-reviewed later production procedure follows approved spec Phases 5–7: merge, preserve legacy
runtime state, migrate/deploy/switch/smoke, stabilize, then operational cleanup.

## Plan Completion Definition

Plan execution is complete only when Task 25 stops with a clean, fully verified rewrite branch ready
for human review. Production deployment/cutover and operational cleanup remain separately authorized
operations. Any discovered real user data changes execution immediately to
`STOP → dedicated migration specification and plan`; clean-schema assumptions never authorize data
destruction.
