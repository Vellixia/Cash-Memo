# Cashmemo V1 Rebuild Design

**Date:** 2026-08-21

**Status:** Approved in-chat design; awaiting written-spec review

**Classification:** ARCHITECTURAL

**Rewrite branch:** `rewrite/cashmemo-v1`
**Base branch and commit:** `new-cashmemo` at `c428e2dd334fcfbcb4e63d421919282a55227845`

## 1. Executive Summary

Cashmemo V1 replaces the existing application with a deliberately smaller personal money journal. It optimizes for correct calculations, fast manual transaction entry, understandable monthly reporting, low cognitive load, security, and maintainability.

The rewrite uses a temporary parallel-build strategy. The legacy Vite/Fastify application remains runnable for comparison and rollback while an independent Next.js/Rust/PostgreSQL V1 is built. V1 does not import the legacy domain model, schema, API contracts, or business logic. After V1 passes its own gates and the data-preservation decision is resolved, V1 is promoted to the canonical repository structure and the legacy application is removed before merge.

The target runtime is intentionally small:

```text
Internet
   |
Dokploy / Traefik
   |-- /* ----------> Next.js
   `-- /api/v1/* ---> Rust / Axum ---> PostgreSQL

Dokploy schedules bounded Rust commands for recurrence and cleanup.
pgBackRest writes encrypted PostgreSQL backups to S3-compatible storage.
```

No application implementation, migration, deployment, or merge is authorized by this document. The next phase begins only after written-spec review and explicit approval.

## 2. Product Goals

Cashmemo helps one individual understand where money comes from, where it goes, and how actual spending compares with intended monthly budgets.

Priority order:

1. Correctness
2. Simplicity
3. Security
4. User experience
5. Maintainability
6. Performance
7. Future extensibility

V1 goals:

- Fast manual income and expense entry.
- Clear current-month income, expense, net, category spending, and budget progress.
- Simple organization through currency-specific wallets and flat categories.
- Exact, testable money calculations without floating point.
- Strict per-user isolation enforced by Rust queries and relational constraints.
- Mobile-first responsive experience with a practical installable PWA shell.
- Small deployment footprint compatible with existing Dokploy/Traefik/PostgreSQL operations.
- Explicit data lifecycle for transactions, sessions, tokens, and account deletion.

## 3. V1 Scope

V1 includes:

- Personal user accounts only.
- Registration, email verification, login, logout, forgot/reset password, session expiration, logout current session, and logout all sessions.
- Wallets with immutable currency and opening balance.
- Income and expense transactions.
- User-owned flat income and expense categories.
- Multiple currencies without conversion.
- Monthly category-and-currency budgets.
- Daily, weekly, monthly, and yearly recurring transactions.
- Paginated transaction history, filters, literal substring search, edit, Trash, restore, and permanent deletion.
- Current-month dashboard and budget progress.
- Responsive web application and non-financial static PWA shell caching.
- Seven-day account-deletion grace and live-data purge.
- Structured logs, request IDs, health/readiness, migrations, CI, Dokploy deployment, PostgreSQL backup, and restore verification.

## 4. Explicit Non-Goals

V1 excludes:

- Bank integration, synchronization, or import.
- Credit/debit card integration or payment initiation.
- Receipt OCR or attachments.
- AI, voice input, AI advice, or provider orchestration.
- Investment, crypto, loan, debt, or tax management.
- Double-entry accounting.
- Family, shared, team, or organization accounts.
- Live or historical FX conversion.
- Budget rollover, envelope budgeting, forecasting, or advanced automation.
- Split transactions.
- Advanced recurrence rules, arbitrary intervals, exceptions, or end conditions.
- Native iOS or Android applications.
- Offline financial-write synchronization.
- Microservices, Redis, Kafka, RabbitMQ, Kubernetes, GraphQL, CQRS, or event sourcing.
- Complex analytics or financial forecasting.
- Feature parity with excluded legacy functionality.

## 5. Privacy Boundary

Cashmemo stores private personal financial tracking information. It does not claim to contain no personal data.

Allowed examples include amounts, currency codes, dates, wallet names, categories, and optional notes. Cashmemo does not intentionally model or collect bank account numbers, card numbers, CVVs, PINs, bank credentials, bank access tokens, or government identifiers.

Free-form notes can contain user-entered information. The transaction UI warns users not to enter banking credentials or sensitive identifiers.

Application logs and telemetry never include passwords, cookies, raw tokens, email addresses, notes, amounts, category or wallet names, raw search queries, request bodies, response bodies, or database URLs.

## 6. Existing Repository Assessment

### 6.1 Current architecture

The repository at the rewrite base contains approximately 501 tracked files and roughly 71,000 lines across TypeScript, TSX, SQL, YAML, and Markdown.

Current stack:

- pnpm TypeScript monorepo.
- Vite + React frontend using React Router.
- Fastify TypeScript backend.
- PostgreSQL accessed through `pg` and Drizzle schema/migrations.
- Better Auth with Argon2id and database sessions.
- Handwritten browser `fetch` clients plus generated contract types from `@hey-api/openapi-ts`.
- TanStack Query provider present, but feature components largely manage requests with local React state.
- React Hook Form installed but not used by current application flows.
- Vitest, fast-check, React Testing Library, Playwright, Testcontainers, and extensive acceptance/security/operations suites.
- Docker/Dokploy deployment, pgBackRest, S3-compatible RustFS/MinIO integration, GitHub Actions, image scanning, and evidence artifacts.

Current backend modules include auth/identity, onboarding, memos, drafts, assisted capture, labels, history, reporting, export, deletion, privacy, and operations. The primary server bootstrap is about 1,300 lines and wires many routes and infrastructure concerns directly.

Current frontend features include auth/onboarding, manual memo form, natural-language and voice capture, degraded draft recovery, labels, history/search, current-month reporting, monthly review, export, and account deletion. The main authenticated route component coordinates most product features. No CSS, Tailwind, shadcn component system, reusable visual primitives, logo, icon, or branding image assets were found. PWA-related dependency exists, but service-worker/manifest registration was not found.

### 6.2 Existing schema and functionality

The existing PostgreSQL design contains 23 tables covering users, credentials, verification tokens, sessions, profiles, preferences, categories, money spaces, money memos, capture/draft/provider state, idempotency, export, deletion, jobs, currency registry, audit, and history traversal.

Existing strengths:

- Direct `user_id` ownership on account-owned records.
- Composite and RLS-oriented isolation tests.
- Exact integer-minor-unit money model with reviewed currency exponents.
- Manual income/expense transaction APIs.
- Category and money-space lifecycle behavior.
- Search and deterministic currency-separated reporting.
- Email verification, password reset, sessions, account export, and account deletion.
- Real PostgreSQL integration tests and extensive security/privacy test knowledge.
- PostgreSQL preservation documentation and restore/runbook work.

Gaps relative to new V1:

- Money spaces are not currency-owning wallets.
- Budgets do not exist.
- Recurring transactions do not exist.
- Current frontend architecture is not Next.js or shadcn/Tailwind.
- Current backend is not Rust/Axum/SQLx.
- Current generated contract is not the browser's authoritative Axios/Orval client.
- Existing UI architecture and styling do not meet the target mobile product design.
- Existing scope includes substantial AI/voice/export/operations machinery explicitly excluded from V1.

### 6.3 Repository evolution

Recent history shows a repository reset for a prior Cashmemo MVP on 2026-08-09, followed by rapid delivery of PostgreSQL foundations, auth/onboarding, manual journaling, history, reporting, AI/voice capture, degraded operation, export/deletion, infrastructure, backup, container hardening, and CI fixes through 2026-08-18. The most recent commits focus heavily on immutable images, vulnerability scanning, verifier images, and GHCR evidence.

This history explains why the current application contains strong security/operations knowledge but also a large amount of complexity unrelated to the simpler V1 product.

### 6.4 Baseline state

At inspection time:

- Worktree was clean at `c428e2d`.
- Existing Superset linked worktree was reused and branch renamed to `rewrite/cashmemo-v1`.
- Format/lint gate passed.
- Unit/property gate passed.
- Typecheck/drift gate failed at `apps/server/tests/unit/error-mapper.spec.ts:30` with pre-existing `TS7053` indexing behavior.

The `TS7053` failure is documented legacy baseline debt. Fixing it is unrelated cleanup and is not part of the V1 rewrite.

### 6.5 Existing-data evidence

Repository evidence does not show an approved production deployment or production migration process. `ops/evidence/external/dokploy-environment.json` reports an external blocker and `approved: false`. PostgreSQL preservation documentation names an existing development/test PostgreSQL service and volume.

Design assumption: existing PostgreSQL data is development data unless environment inspection proves otherwise. V1 therefore uses a clean replacement schema and does not spend architecture effort on legacy schema compatibility.

This assumption never authorizes destructive action. The mandatory preservation gate in Section 25 applies before any destructive reset, production-target migration, deployment, or route cutover.

## 7. Legacy REUSE / ADAPT / REPLACE / REMOVE Assessment

**REUSE**

- Product name.
- Cross-user isolation test scenarios.
- Privacy-boundary knowledge.
- PostgreSQL preservation warning.
- Backup/restore knowledge.
- Rationale: these are product or operational facts independent of legacy runtime architecture.

**ADAPT**

- GitHub Actions structure.
- Dokploy/Traefik routing.
- Container hardening.
- pgBackRest/S3 patterns.
- Environment/secrets injection.
- Health/readiness.
- PostgreSQL integration-test setup.
- OpenAPI drift checks.
- Email-delivery configuration if production-compatible.
- Rationale: existing patterns are useful, but service names, commands, runtime assumptions, and credentials must fit Next.js/Rust.

**EVALUATE**

- Existing ISO/CLDR currency registry data.
- Integer minor-unit money model.
- Security headers.
- Secret/dependency scanning.
- Exact email provider.
- Rationale: these may be correct independent of legacy. Selection must follow V1 semantics and verified environment evidence.

**REPLACE**

- Vite frontend.
- Fastify backend.
- TypeScript domain packages.
- Better Auth integration.
- Current API and 23-table schema design.
- Money-space model.
- Handwritten fetch clients.
- Current state management, reporting, and lifecycle logic.
- Rationale: target architecture, domain ownership, and user flows differ materially.

**REMOVE AT FINAL REPLACEMENT**

- AI/STT/voice/drafts.
- Provider attempts and temporary audio.
- Export object lifecycle.
- Complex deletion-suppression system.
- Unused frontend dependencies.
- Legacy verifier/evidence machinery not justified by V1.
- Obsolete routes, contracts, containers, CI, and docs.
- Rationale: these are explicit V1 non-goals or temporary legacy support.

Legacy migrations are not removed merely because the schema is replaced. They remain until the preservation audit resolves whether any real data requires migration or continued historical material.

## 8. Chosen Replacement Strategy

### 8.1 Decision

Use a temporary parallel clean rebuild with selective reuse.

Temporary shape:

```text
legacy
├── apps/web
├── apps/server
├── packages/*
└── legacy migration history

temporary V1
└── v1
    ├── web
    ├── api
    └── api/migrations
```

Final shape after branch replacement:

```text
apps/web   Next.js
apps/api   Rust/Axum
```

The temporary V1 path names may be adjusted during implementation planning, but the invariant is independent builds and a single canonical application before merge.

### 8.2 Isolation requirements

- V1 cannot import legacy domain packages, schema code, generated contracts, or business logic.
- Legacy and V1 have distinct build/test commands.
- Legacy and V1 use separate PostgreSQL database targets during parallel work, not merely different schema names when a separate database is available.
- Legacy and V1 use separate `DATABASE_URL` secret names and migration histories.
- V1 migration tooling cannot modify the legacy database.
- Legacy remains runnable for behavioral comparison and rollback until V1 passes its own gates.
- V1 acceptance does not require parity with explicit non-goals.
- The final rewrite branch removes the legacy application and temporary dual-stack scaffolding before merge.

### 8.3 Alternatives considered

Progressive in-place replacement was rejected because Fastify/TypeScript/schema assumptions would leak into the Rust/Next.js design and require complex transitional tests.

Immediate repository reset was rejected because it would remove the runnable comparison/rollback reference before V1 verification and create a difficult first review.

Trade-off: parallel build temporarily duplicates commands and infrastructure configuration. An explicit final-replacement gate prevents permanent dual maintenance.

## 9. Target Architecture

```text
                    Internet
                       |
                Dokploy / Traefik
                       |
            +----------+----------+
            |                     |
            v                     v
         Next.js               Rust/Axum
           /*                 /api/v1/*
            |                     |
            | generated REST     v
            +----------------> PostgreSQL

Dokploy scheduled command ----> Rust command entry points
pgBackRest --------------------> encrypted S3-compatible repository
```

Responsibilities:

- Next.js owns rendering, forms, navigation, responsive UX, and static PWA assets.
- Rust owns authentication, authorization, input validation, money/currency rules, balances, budgets, recurrence, lifecycle, and reporting queries.
- PostgreSQL is the sole application state store.
- pgBackRest and its credentials belong exclusively to infrastructure.
- Next.js does not implement parallel API/business logic through API routes or Server Actions.
- Redis, object storage for application records, and continuously running job services are absent.

## 10. Backend Architecture

Rust stack:

```text
Rust
Axum
Tokio
Tower
tower-http
Serde
SQLx
rust_decimal
Argon2
tracing
utoipa / utoipa-axum
```

Modular monolith modules:

```text
auth
wallets
categories
transactions
budgets
recurring
reporting
account_lifecycle
```

`reporting` is read/query composition, not a duplicate business-logic layer. It calls the same money/time invariants used by mutations and returns derived views.

Shared code is limited to configuration, authenticated request context, API errors, money/currency primitives, time helpers, SQL transaction helpers, request IDs, and tracing. SQLx queries may live beside focused services when no meaningful repository abstraction exists.

No pattern-for-pattern's-sake controller/facade/use-case/repository/adapter stack is required. A small `EmailSender` trait is justified because email delivery is external and differs between development and production.

## 11. Relational Data Model

Primary V1 tables:

```text
users
sessions
auth_tokens
currencies
wallets
categories
transactions
budgets
recurring_transactions
recurring_occurrences
account_deletion_requests
```

All user-owned financial tables contain `user_id`. Important constraints include:

- Foreign keys and cascading behavior defined explicitly.
- `transactions` carries direct `user_id` plus `wallet_id` and `category_id`.
- Composite foreign key `(wallet_id, user_id)` references wallet ownership.
- Composite category relationship enforces `(category_id, user_id, transaction_type)` compatibility.
- `budgets` permits only expense categories.
- Unique `(user_id, category_id, currency_code, month_start)` budget key.
- Unique `(recurring_transaction_id, scheduled_for)` occurrence key.
- Unique nullable `transactions.recurring_occurrence_id` enforces at most one generated transaction per occurrence.
- Transaction deletion does not cascade into `recurring_occurrences`.
- Appropriate `CHECK` constraints protect enum states, positive amounts, currency formatting, month-first-day representation, and lifecycle field consistency.
- `created_at` and `updated_at` are `TIMESTAMPTZ` UTC instants.

Application authorization plus relational ownership constraints are authoritative in V1. PostgreSQL RLS is deferred as a post-V1 hardening option unless implementation evidence establishes a concrete need. Runtime DB role is non-owner; migration credentials are separate.

## 12. Money and Currency Semantics

### 12.1 Representation decision

Use:

```text
PostgreSQL NUMERIC(20,4)
Rust rust_decimal::Decimal
API decimal strings
```

Example:

```json
{
  "amount": "500.00"
}
```

Integer minor units were considered and remain correct, but they require conversion and exponent handling at SQL, Rust, OpenAPI, and TypeScript boundaries. `NUMERIC` plus `Decimal` maps more directly to V1's decimal-string API while retaining exact arithmetic.

### 12.2 Supported currencies

Cashmemo does not imply support for every ISO 4217 entry. It supports a reviewed, configured subset of ISO 4217 currencies whose exponent is between 0 and 4 and fits `NUMERIC(20,4)`. Initial enabled data must include IDR, USD, and EUR. Each configured currency stores uppercase code, display name, exponent, and enabled state.

Unsupported currency codes are rejected. A configured currency cannot be disabled while referenced without an explicit data-safe policy.

### 12.3 Invariants

- Transaction, budget, and recurring amounts are greater than zero.
- Wallet opening balance may be zero but not negative.
- Transaction type, not amount sign, expresses direction.
- Maximum value has 16 integer digits and 4 fractional digits.
- Rust validates syntax, range, supported currency, and exact exponent before any SQL execution.
- Excess fractional precision is rejected; it is never sent to PostgreSQL and never silently rounded.
- PostgreSQL fixed-scale constraints are defense-in-depth, not the primary boundary validator.
- Integration tests prove excess precision leaves the database unchanged.
- Stored calculations never use `f32` or `f64`.
- API serialization uses the currency's configured exponent consistently.
- Presentation percentages may round half-up; authoritative money never rounds implicitly.

### 12.4 Currency ownership and default

Each wallet owns one immutable currency. Transactions derive currency from their wallet and do not accept a separate currency field.

User `default_currency` only preselects new wallet/budget currency and orders that currency first in UI. It is not a conversion target or reporting currency.

No report adds unlike currencies. Dashboard, category breakdown, budgets, and balances remain separated by currency.

## 13. Authentication and Sessions

### 13.1 Users and email

User status:

```text
pending_verification
active
pending_deletion
purging
```

Email normalization is intentionally conservative: trim leading/trailing whitespace and lowercase. The result is Cashmemo's unique login identifier. Cashmemo does not apply Gmail dot normalization, strip plus aliases, or perform provider-specific alias normalization.

### 13.2 Passwords

- Minimum 15 Unicode code points.
- Maximum 128 characters.
- UTF-8 encoding is capped at 512 bytes before Argon2; the value is rejected rather than truncated.
- Spaces and Unicode are allowed.
- No composition rules.
- No silent truncation.
- Argon2id PHC hashes with random salt.
- Initial deployment candidate is 64 MiB memory, `t=3`, `p=1`.
- Actual production parameters must be benchmarked on production-class host and remain operationally reasonable.
- Successful login may rehash outdated parameters.

### 13.3 Auth tokens

`auth_tokens.purpose` is limited to:

```text
EMAIL_VERIFICATION
PASSWORD_RESET
```

Fields include `user_id`, `token_hash`, purpose, creation, expiry, and optional consumption instant.

- Raw token contains 256 random bits.
- Lookup is `raw token -> SHA-256 -> indexed database lookup`.
- SHA-256 is appropriate because tokens are high-entropy random values, not passwords.
- Raw values never enter logs.
- Verification expires after 24 hours.
- Password reset expires after 30 minutes.
- Tokens are single-use.
- Consumption and account mutation occur in one DB transaction.
- Replacement consumes prior unconsumed token for same user/purpose.
- Invalid, expired, and consumed tokens share safe public failure.
- Consumed tokens and expired tokens are purged within 24 hours by bounded cleanup command.
- Unverified accounts with no financial data are cleaned after seven days.

### 13.4 Registration and login enumeration

Registration returns a generic accepted response and sends verification email when eligible. It does not create a session. Existing unverified addresses may receive replacement verification. Existing verified addresses do not reveal account existence.

For login:

- Nonexistent email and wrong password return identical invalid-credentials response.
- `EMAIL_NOT_VERIFIED` is returned only after password successfully verifies.
- Pending-deletion state is revealed only after password successfully verifies.

### 13.5 Sessions

Cookie:

```text
__Host-cashmemo_session
Secure
HttpOnly
SameSite=Lax
Path=/
no Domain
```

Session storage is minimal:

```text
id
user_id
token_hash
created_at
last_seen_at
expires_at
revoked_at?
```

No IP history, geolocation, detailed device fingerprint, or persisted user-agent history is required.

- Raw cookie token contains 256 random bits; only SHA-256 hash is stored.
- Absolute expiration is 30 days and is a hard upper bound.
- Idle expiration is 7 days.
- `last_seen_at` updates at most hourly, making idle tracking intentionally approximate by about one hour.
- Logout current revokes current session and clears cookie.
- Logout all and password reset revoke every existing session transactionally.

### 13.6 Authentication throttling

V1 assumes one Rust API replica. A bounded in-memory Tower middleware limiter protects registration, verification resend, login, and password-reset request endpoints. The trusted HTTP edge may add a coarse outer limit, but correctness does not depend on Redis or persistent login-attempt history.

Exact per-IP and per-normalized-login-identifier thresholds and windows are deployment configuration. They must deter obvious automated abuse without exposing whether an account exists. Rejected requests return `429`; focused tests cover threshold, expiry, and enumeration-safe responses. Restarts may clear in-memory counters. A distributed/shared limiter becomes necessary only if Cashmemo later runs multiple API replicas.

### 13.7 CSRF and origins

- `GET`, `HEAD`, and `OPTIONS` never mutate application state.
- `POST`, `PUT`, `PATCH`, and `DELETE` require exact match against configured allowed `Origin`.
- Substring or suffix origin matching is forbidden.
- Missing or invalid `Origin` on browser unsafe requests is rejected.
- Production is one origin and does not enable cross-origin CORS.
- Development origins are explicit configuration.
- No separate CSRF-token subsystem is needed for browser V1.

### 13.8 Pending-deletion authentication

Pending-deletion email/password login creates deletion-restricted access. It allows only:

- Get deletion status.
- Cancel account deletion.
- Logout.

Password-reset request and consumption remain unauthenticated recovery endpoints, not permissions of deletion-only session. Resetting password does not cancel deletion.

## 14. Authorization

Axum middleware/extractor resolves the server-side session and authenticated `user_id`. Every protected financial query explicitly scopes by this value. Client-supplied `user_id` is never authoritative.

V1 boundary:

```text
authenticated user_id
+ explicit user-scoped SQL
+ user_id on financial tables
+ composite ownership foreign keys
+ non-owner runtime DB role
+ separate migration role
+ cross-user integration/security tests
```

Foreign-owned resource IDs return the same `404` as nonexistent IDs. Filter, nested-reference, mutation, restore, Trash, and reporting paths reapply ownership.

RLS is not required for V1 correctness. If later adopted, application scoping and composite constraints remain authoritative and RLS is defense-in-depth only.

### 14.1 Text Input Limits

Rust enforces product limits authoritatively by Unicode code points. Frontend mirrors them for immediate feedback. PostgreSQL may use `TEXT`; database type width is not product validation. Input is rejected rather than silently truncated.

- Wallet name: 1–80 Unicode code points after trim.
- Category name: 1–80 Unicode code points after trim.
- Transaction note: 0–500 Unicode code points.
- History search `q`: 0–100 Unicode code points after trim; empty means no text filter.

## 15. Wallets

Wallet fields include user, name, immutable currency, opening balance, active/archived state, and timestamps.

Choose `wallet.opening_balance`, not a synthetic transaction.

- Included in current wallet balance.
- Excluded from income, expense, net, categories, budgets, and transaction history.
- Editable as wallet state; UI explains it changes starting balance rather than financial activity.

Current wallet balance is:

```text
opening balance
+ all-time active income with occurred_at <= now
- all-time active expense with occurred_at <= now
```

Trash and future-dated transactions do not contribute. Future recurring rules are not transactions and do not contribute.

Lifecycle:

- Archive preserves history and removes wallet from new-entry choices.
- Archiving transactionally pauses active recurring rules using wallet and explains consequence before confirmation.
- Restore returns wallet to choices; paused rules stay paused until explicit resume.
- Hard delete is allowed only when no active/Trash transactions, recurring rules, or occurrence references exist.
- Currency never changes; user creates another wallet if currency is wrong.

## 16. Categories

Categories are flat, user-owned, and typed `INCOME` or `EXPENSE`. Every transaction requires matching category type.

Onboarding idempotently seeds sensible categories, including Food, Transport, Housing, Shopping, Health, Entertainment, Education, Travel, Bills, Other, Salary, Business, Gift, Refund, and Other Income.

Seeded and custom categories behave uniformly in primary UI. Provenance metadata may exist internally but does not create special user behavior.

Seeded rows use stable internal `starter_key`. A unique `(user_id, starter_key)` constraint for non-null keys makes backend seeding idempotent across interrupted or repeated onboarding.

Name normalization is deterministic and small: trim leading/trailing whitespace and compare/store lowercase normalized value. Do not strip accents, perform provider/domain rules, or introduce elaborate Unicode normalization. Active names are unique per user and category type using a partial unique constraint. Restore fails clearly if active-name conflict exists.

- Rename changes label shown on historical transactions.
- Archive preserves history and prevents new selection.
- Archive pauses active recurring rules using category.
- Restore re-enables selection but does not resume rules.
- Hard delete requires no transaction, budget, recurring-rule, or occurrence references.

## 17. Transactions and Lifecycle

Authoritative fields:

```text
id
user_id
wallet_id
category_id
type: INCOME | EXPENSE
amount
occurred_at
note?
deleted_at?
purge_after?
recurring_occurrence_id?
created_at
updated_at
```

Creation defaults `occurred_at` to current user-local date/time converted to UTC. Optional date/time adjustment uses user timezone. Editing preserves exact stored instant unless user changes it.

Amounts remain positive. Type controls direction. Note is optional and length-limited.

Lifecycle invariants:

```text
active:
  deleted_at IS NULL
  purge_after IS NULL

Trash:
  deleted_at IS NOT NULL
  purge_after = deleted_at + 30 days
```

- Delete sets both fields consistently.
- Restore clears both fields.
- Trash transactions disappear from balances, budgets, and reports.
- Restore re-enters all applicable calculations.
- Explicit permanent deletion requires irreversible confirmation.
- Automatic purge selects only `purge_after <= now()`.
- A Trash Undo shortcut calls normal server restore mutation; it is never local-only.
- Generated transactions are ordinary editable/deletable records after creation.

## 18. Budgets

Budget key:

```text
user + expense category + currency + local calendar month
```

Month is stored as first-day `DATE`, such as `2026-08-01`. Amount is positive. Currency is explicit because one category may be used with wallets in multiple currencies.

Spent is derived, never persisted. It sums active expense transactions matching user, category, wallet currency, and local month, with `occurred_at <= now()` for current/future periods.

Create, edit, delete, restore, wallet/category/date change, and future-time arrival affect progress through authoritative queries. Remaining may be negative and progress may exceed 100%.

Archived categories preserve existing budget history but cannot receive new budgets. V1 has no rollover, envelopes, forecasting, percentage-of-income rules, or automation.

## 19. Recurring Transactions

Supported frequencies:

```text
daily
weekly
monthly
yearly
```

Rule fields include user, wallet, category, type, amount, optional note, frequency, `start_date`, `next_due_date`, active/paused status, and timestamps.

Calendar behavior:

- Daily follows each local calendar day.
- Weekly anchors weekday to `start_date`.
- Monthly anchors original day; missing days use month's final day without losing anchor.
- Yearly anchors month/day; February 29 uses February 28 in non-leap years.
- On creation with past `start_date`, `next_due_date` is first cadence date on or after current user-local date. No historical backfill occurs.
- Catch-up applies only to due dates missed after active rule began.
- Pause dates are never backfilled.
- Resume chooses first cadence date on or after resume date.
- Edits affect future occurrences only.
- Changing user timezone does not rewrite existing transactions or occurrences. Future local dates use new timezone when converted to `occurred_at`.

`recurring_occurrences` is immutable scheduling/idempotency history. It contains rule, `scheduled_for` local date, creation metadata, and no financial amount authority.

Relationship:

- `transactions.recurring_occurrence_id` is nullable and unique.
- At most one generated transaction may reference occurrence.
- Deleting/purging transaction leaves occurrence intact.
- Scheduler treats existing occurrence as completed scheduling decision and never recreates transaction.
- Unique `(recurring_transaction_id, scheduled_for)` prevents duplicate occurrence.
- Occurrence and transaction creation happen in one PostgreSQL transaction.

Processor runs bounded batches and resumes later. One stale rule cannot produce unbounded work in one invocation.

Upcoming rules/occurrences are not transactions. They do not enter history, balances, dashboard, or budget spent until ordinary transaction is generated.

## 20. Timezone Semantics

- All instants use `TIMESTAMPTZ` and UTC storage.
- User stores validated IANA timezone, suggested from browser and confirmed during onboarding.
- Manual `occurred_at` is interpreted in user timezone and converted to UTC.
- Recurrence `scheduled_for` is local `DATE`; generated instant is first valid instant of scheduled local day.
- Date filters use inclusive local start and exclusive start of day after end date.
- Dashboard and budgets use user-local calendar month.
- Changing timezone recomputes historical display/month boundaries; UI warns boundary transactions may move.
- Changing timezone never rewrites stored transaction instant or existing occurrence.
- V1 does not store historical timezone snapshots or tzdb versions.

## 21. Reporting, Dashboard, and History

Reporting is query composition over authoritative rows.

Dashboard answers:

- How much came in?
- How much went out?
- What is difference?
- Where did spending go?
- How is budget progressing?

Use a small number of purpose-built reads rather than one endpoint per card:

- Monthly summary with currency-separated income, expense, net, and category breakdown.
- Budget summary for selected month/currency.
- Recent transactions query.

Current-period calculations exclude future-dated transactions until `occurred_at <= now()`.

History defaults to active newest-first rows and supports:

- Explicit `Load more` cursor pagination.
- Date, type, wallet, and category filters.
- Literal case-insensitive substring search across note, category name, and wallet name.
- Edit and lifecycle actions.

Search escapes `%`, `_`, and the chosen SQL escape character before `ILIKE`, so user input is literal rather than query syntax. No fuzzy search, external search service, or advanced query language exists.

Cursor order is `(occurred_at DESC, id DESC)`. Cursor is opaque but untrusted. Rust decodes and validates version, types, lengths, and bounds before use. Tampering may move traversal start but never changes user scoping. Default page size is 50 and maximum 100. No total count is required.

Initial indexes:

```text
(user_id, occurred_at DESC, id DESC) WHERE deleted_at IS NULL
(user_id, purge_after) WHERE deleted_at IS NOT NULL
```

Wallet/category secondary indexes and trigram search require realistic query-plan evidence. Type does not receive dedicated index by default.

## 22. REST API Design

Base path is `/api/v1`. JSON success returns resource directly. Collections return:

```json
{
  "items": [],
  "next_cursor": null
}
```

Representative resources:

- **Auth:** register, resend verification, verify email, login, logout, logout-all, session, and password-reset request/consume.
- **Profile:** get/update timezone and default currency.
- **Wallets:** list, create, get, update name/opening balance, archive, restore, and delete if eligible.
- **Categories:** list, create, rename, archive, restore, and delete if eligible.
- **Transactions:** list, create, get, update, move to Trash, restore, permanent delete, and list Trash.
- **Budgets:** list/progress, create, update, and delete.
- **Recurring:** list, create, update future rule, pause, and resume.
- **Reports:** monthly summary and budget summary.
- **Account deletion:** request, status, and cancel.
- **Operations:** liveness and readiness.

Error envelope:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Check the highlighted fields.",
    "fields": {
      "amount": ["Amount has too many fractional digits for USD."]
    },
    "request_id": "0198..."
  }
}
```

Status conventions:

- `400` malformed JSON/query syntax.
- `401` absent/expired session.
- `403` authenticated but blocked account state.
- `404` missing or foreign-owned resource.
- `409` uniqueness/lifecycle conflict.
- `422` well-formed invalid input.
- `429` auth throttling.
- `500` safe unexpected failure.

Rust middleware generates canonical request ID. Incoming `X-Request-Id` is ignored unless implementation validates strict size/format. Canonical value appears in response header and error body.

## 23. OpenAPI and Frontend Client Generation

```text
Axum + utoipa schemas
-> deterministic OpenAPI JSON
-> Orval
-> generated TypeScript types
-> Axios client
-> TanStack Query hooks
```

- Rust is contract and validation authority.
- A Rust command exports checked-in deterministic OpenAPI artifact.
- Orval output lives in dedicated generated directory and is never manually edited.
- Shared Axios instance uses credentials and maps stable errors.
- CI regenerates OpenAPI and Orval output and fails on drift.
- Zod supplies immediate client feedback only.
- Next.js never duplicates financial calculation, currency, budget, recurrence, lifecycle, or authorization logic.

## 24. Frontend Architecture and UX

### 24.1 State ownership

- **Form state:** React Hook Form.
- **Immediate validation:** Zod.
- **Authoritative validation/calculation:** Rust/PostgreSQL.
- **Remote state/cache:** TanStack Query.
- **HTTP:** Axios.
- **Generated API/types/hooks:** Orval.
- **Filters/month selection:** URL search parameters.
- **Dialog/sheet/disclosure:** local React state.

No Redux or Zustand is introduced without a demonstrated need.

Private query state clears on logout and session expiration. Return path after session expiry is accepted only for validated internal authenticated GET destinations and never destructive/action URLs.

Targeted invalidation follows affected scopes. A transaction moving between month, wallet, or category invalidates both old and new history/month/wallet/budget keys. It does not blindly refetch the whole application.

Cashmemo never optimistically invents balance, budget, income, expense, or net values. Pending buttons, dialog close after server success, success toast, and post-confirmation row removal are allowed.

### 24.2 Navigation and routes

Mobile navigation:

```text
Dashboard | History | Add | Budgets | More
```

Desktop uses equivalent sidebar.

Canonical routes include auth screens, `/app`, transaction list/new/detail/Trash, wallets, categories, budgets, recurring, settings, and `/account-deletion`.

`/app/transactions/new` is always canonical. Mobile renders focused full page. Desktop may render same route in modal only if deep-link, refresh, back, focus trap/restoration, and direct navigation remain correct. Otherwise desktop uses normal page. There is one form implementation.

### 24.3 Onboarding

```text
register
-> verify email
-> login
-> confirm timezone
-> choose default currency
-> create first wallet
-> dashboard
```

Backend category seeding is idempotent. Repeated/interrupted onboarding cannot duplicate categories. Completion is derived from actual state where practical: timezone configured, default currency configured, seed version present, and active wallet exists. No elaborate onboarding state machine is required.

### 24.4 Transaction entry

```text
Add
-> Expense default
-> Amount
-> Category
-> Wallet
-> optional note/date-time
-> Save
```

- If exactly one active wallet exists, preselect before amount entry.
- With multiple wallets, preselect last-used active wallet when available; otherwise wallet is required before final amount validation. Last-used value is returned by Rust from most recently created transaction whose wallet remains active; it is not persisted in browser storage.
- Amount may remain visually first, but currency is deterministic before authoritative precision validation.
- Changing wallet preserves amount when valid. Invalid new exponent produces error; amount is never altered silently.
- New transaction defaults to current user-local date/time.
- Editing preserves exact stored instant unless changed.
- Submit disables while pending; failure preserves form.
- Note warns against banking credentials/sensitive identifiers.
- No offline submission queue.

### 24.5 Major flows

Dashboard shows currency-separated monthly summary, category spending, budget progress, and recent transactions. Default currency appears first. Empty state offers Add Expense/Add Income, or Create Wallet if none exists.

History uses URL filters, explicit Load more, desktop inline filters, and mobile filter sheet. Applying filters resets cursor. Empty state distinguishes no transactions from no matches.

Trash shows purge date, Restore, and Delete Forever. Undo after deletion invokes authoritative restore endpoint.

Wallet management shows name, currency, current due-only balance, and active/archive state. Archive warns active recurring rules will pause. Currency is immutable.

Category management uses Income/Expense tabs and treats seeded/custom categories uniformly. Rename warns historical labels change. Archive warns recurrence pauses.

Budgets default to current local month and default currency. Each displays budget, spent, remaining, and percentage. Overspending uses text and color-independent status.

Recurring list shows type, amount/currency, category, wallet, frequency, next date, and active/paused state. Past start date explains no historical generation. Resume explains paused dates are not backfilled.

Settings contains timezone, default currency, current session, logout all, and account deletion. Timezone change warns about boundary reporting and future recurrence conversion.

Pending-deletion screen contains only deletion date, Cancel Account Deletion, and Sign Out.

### 24.6 Major screen contracts

**First visit**

- Goal/action: understand purpose; Log In or Create Account.
- Required information: product purpose and privacy boundary.
- States: static public content; safe unavailable state if navigation fails.
- Mobile: single column; primary actions remain above fold.

**Register and verify email**

- Goal/action: create account, then complete ownership proof or resend.
- Required information: email, 15–128-character password, privacy guidance, and verification token from URL.
- States: pending disables submit; errors link to fields; invalid/expired verification offers resend; success links to login.
- Mobile: correct email/password keyboards; focused single-column status/form.

**Login and password recovery**

- Goal/action: start session or recover password.
- Required information: email/password, or email, or reset token plus new password.
- States: generic invalid credentials; reset request always generic; verified success enters onboarding/app; pending deletion enters restricted screen.
- Mobile: full-width focused forms and visible password controls.

**Onboarding**

- Goal/action: establish usable account.
- Required information: confirmed timezone, default currency, and first wallet.
- States: derive missing steps, retry idempotently, and open dashboard on completion.
- Mobile: one short step per screen where needed.

**Dashboard**

- Goal/action: understand current month and add transaction.
- Required information: currency-separated monthly, budget, and recent data.
- States: no wallet offers Create Wallet; no activity offers Add Expense/Income; small read set supports section-level retry.
- Mobile: currency chips, stacked cards, and bottom navigation.

**New transaction**

- Goal/action: save income/expense quickly.
- Required information: type, deterministic wallet/currency, amount, matching category, optional note/time.
- States: preserve form on error; server-confirmed success closes/navigates and invalidates affected scopes.
- Mobile: canonical full-page route with amount focus and numeric keyboard.

**History and transaction detail**

- Goal/action: find, load more, inspect, and edit transactions.
- Required information: current filters, items/cursor, and authoritative selected transaction.
- States: distinguish no data/no matches; retry failed page without losing prior items; missing/foreign resource is safe not found; failed save preserves form.
- Mobile: accessible filter sheet, explicit Load more, normal detail page, and separated destructive actions.

**Trash**

- Goal/action: restore or permanently delete.
- Required information: deleted and purge dates.
- States: empty explains 30-day policy; restore/purge errors retain row; success follows server state.
- Mobile: large explicit actions and irreversible confirmation.

**Wallets and categories**

- Goal/action: manage money containers and flat labels.
- Required information: wallet name/currency/opening/current balance/status; category kind/name/status.
- States: empty wallets offer Create Wallet; conflicts explain references; seeded/custom categories look same; archive explains recurring pause.
- Mobile: stacked cards, Income/Expense tabs, touch-safe row menus, and focused edit views.

**Budgets**

- Goal/action: set and understand monthly intent.
- Required information: month, currency, expense category, amount, and derived progress.
- States: empty offers Create Budget; safe retry; success invalidates selected month/category scope.
- Mobile: stacked progress list with visible month/currency controls.

**Recurring**

- Goal/action: manage future generation.
- Required information: template, frequency, start/next date, and status.
- States: empty explains generated transactions; errors preserve rule; pause/resume success shows next date.
- Mobile: compact cards and one focused create/edit form.

**Settings, sessions, and account deletion**

- Goal/action: change preferences/session state, request deletion, or manage grace.
- Required information: timezone, default currency, current session, current password before deletion, and purge date during grace.
- States: save errors preserve server value; logout-all confirms; deletion failure does not change state; request success revokes sessions; restricted view exposes only allowed actions.
- Mobile: grouped settings with destructive action last; focused deletion warning with non-color severity cues.

Every contract uses the shared loading/error/accessibility requirements below; this table defines screen-specific hierarchy rather than pixel-perfect layout.

### 24.7 Screen-state and accessibility contract

Every major screen defines loading, empty, error, success, offline, session-expired, and mobile behavior.

Accessibility requires:

- Visible focus states.
- Logical heading hierarchy.
- No information conveyed by color alone.
- Practical minimum touch targets.
- Keyboard operation.
- Modal focus trap and restoration.
- Reduced-motion preference.
- Field errors programmatically linked to inputs.
- Announced async errors/status.
- No horizontal overflow on supported mobile widths.

### 24.8 PWA and caching

Persistently cache only public static assets such as JS/CSS, fonts, icons, manifest, public branding, and static shell assets containing no user data.

Financial/private information is never persisted through service-worker caches, browser HTTP cache, Next.js data/router cache, CDN/Traefik cache, localStorage, or IndexedDB.

Authenticated HTML, RSC payloads, and API responses use `Cache-Control: no-store`. `private` and `Vary: Cookie` may supplement but are not privacy mechanism. Authenticated pages use dynamic/no-store behavior and are excluded from PWA precache.

Authenticated API remains network-only. Offline state shows banner and disables writes. No queued/replayed write. Logout/session expiry clears TanStack Query state and navigates so private state is not reusable by another session.

## 25. Data Lifecycle

### 25.1 Transaction Trash

- Delete moves transaction to Trash for 30 days.
- Restore available during retention.
- Explicit permanent deletion available with confirmation.
- Bounded scheduled purge removes rows with `purge_after <= now()`.
- Recurring occurrence survives generated transaction purge until account deletion.

### 25.2 Wallet/category lifecycle

Historical references use archive/deactivate rather than destructive removal. Hard delete is limited to unreferenced rows. Archive pauses active recurring rules transactionally; restore does not resume automatically.

### 25.3 Account deletion

```text
active
-> recent password confirmation
-> pending deletion for 7 days
   |-- restricted login -> cancel or sign out
   `-- grace expires -> atomically claimed as purging
                        -> durable deletion receipt
                        -> safe live-data purge
```

Request revokes all sessions. Normal application access is disabled. Cancellation invalidates restricted session and requires normal login. At grace expiry, live user-owned application data is hard-deleted transactionally after durable anti-resurrection receipt creation.

Finalization closes deletion/cancellation race:

- Scheduled purge atomically claims an expired `pending_deletion` request by changing it to `purging` before external receipt work.
- Claim uses row locking or conditional update so concurrent workers cannot claim same account.
- Cancellation succeeds only while state remains `pending_deletion`; once claimed, it returns lifecycle conflict.
- Receipt creation occurs only after successful claim.
- If receipt creation fails, account remains `purging`, live data remains intact, and later bounded run retries.
- Login during `purging` may show deletion-finalizing status and Sign Out, but cannot offer cancellation.
- After durable receipt exists, one database transaction deletes live user data and completes request by removing account-owned rows.

UI explains seven-day grace, disabled normal access, cancellation method, live purge after grace, and that backup copies expire according to infrastructure retention rather than immediately.

## 26. Deployment and Runtime Operations

### 26.1 Long-running topology

```text
cashmemo-v1-web
cashmemo-v1-api
PostgreSQL V1
pgBackRest infrastructure
```

No permanent jobs or migration service exists by default. Same Rust image exposes commands:

```text
serve
migrate
process-recurring
purge-trash
purge-accounts
cleanup-auth-tokens
```

Dokploy schedules bounded commands directly against application image/container. Migration is explicit one-shot deployment operation. API startup never migrates.

### 26.2 Migration target protection

Migration is allowed only when target is:

- Empty and explicitly approved, or
- Contains valid Cashmemo V1 identity/migration metadata.

Unknown non-empty target fails closed even if it contains neither known legacy nor V1 marker. Parallel work prefers distinct V1 PostgreSQL database. Production migration requires preservation gate.

### 26.3 Configuration

Rust application configuration is approximately:

```text
V1_DATABASE_URL
PUBLIC_ORIGIN
COOKIE_SECURE
SESSION_IDLE_SECONDS
SESSION_ABSOLUTE_SECONDS
EMAIL_*
APP_ENV
LOG_LEVEL
```

Backup credentials, repository, retention, S3 destination, and restore configuration belong only to infrastructure. API cannot access backup credentials.

Configuration validates at startup and fails closed. Next.js receives no DB/email/session secret.

### 26.4 Containers and supply-chain scope

Required:

- Multi-stage builds.
- Non-root runtime.
- No unnecessary build tools in runtime.
- Graceful shutdown.
- Resource limits.
- Dependency/container scanning.
- Exact deployed image digest recorded.

Best effort when existing workflow supports cleanly:

- Read-only root filesystem.
- SBOM retention.
- Digest-pinned deployment.

V1 launch does not depend on an elaborate new supply-chain platform.

### 26.5 Health, readiness, and logs

Rust provides liveness and readiness. Liveness proves process responsiveness. Readiness verifies PostgreSQL connection and expected migration identity/version. Email availability does not control readiness. Next.js provides process health suitable for Traefik.

Structured JSON logs contain timestamp, level, canonical request ID, method, route template, status, duration, service, and version. Scheduled commands log success/failure/content-free counts.

Required observability:

- Structured application logs.
- Request latency/status in logs.
- Health/readiness.
- Job success/failure/counts.
- Backup freshness alert.
- Deployment health.

Aggregated metrics, DB pool metrics, and dashboards are optional only when existing infrastructure provides them cheaply. No user analytics or financial telemetry.

## 27. Backup, Recovery, and Anti-Resurrection

Adapt pgBackRest with encrypted external S3-compatible repository:

- Weekly full backup.
- Daily differential backup.
- Continuous WAL archiving.
- Backup destination outside PostgreSQL host failure domain.
- API credentials cannot access backup repository.
- Monthly restore verification in isolated non-production PostgreSQL.
- Quarterly documented recovery drill.
- Backup freshness alert.

Implementation must set and document exact pgBackRest semantics, including `retention-full`, `retention-full-type`, differential retention when overridden, and archive/WAL retention. Nominal 30-day full-retention target does not imply every dependent backup/WAL disappears exactly on day 30. Restore drills measure actual oldest restorable repository age.

Recovery targets remain targets until proven:

- RPO no better than 24 hours without verified WAL recovery.
- Target RPO up to 15 minutes only after continuous WAL archive and PITR tests prove it.
- Target RTO four hours, subject to real drill evidence.

### 27.1 Deletion receipts

To prevent restored backups resurrecting permanently deleted accounts, infrastructure keeps minimal receipt:

```text
HMAC(user_id)
purged_at
key/ledger version
```

- Raw user ID, email, and financial data never enter ledger.
- HMAC secret lives outside application database and its backups.
- The API `serve` process never receives deletion-ledger or backup credentials. Only the scheduled `purge-accounts` command receives narrowly scoped ledger credentials through infrastructure configuration.
- Key rotation preserves evaluation of every unexpired receipt.
- Receipt creation must succeed durably before final live purge; failure delays purge and retries with alert.
- Restored database remains isolated until deletion replay completes.
- Receipt may expire only after verification that no retained/restorable backup predating purge remains, plus a seven-day safety margin.
- This is narrow recovery metadata, not event sourcing or general archival.

## 28. Mandatory Data-Preservation Gate

Before destructive legacy-data action, production-target migration, production replacement deployment, or production route cutover:

1. Resolve actual Dokploy application, PostgreSQL, volume, and backup resource IDs.
2. Identify legacy and V1 targets.
3. Verify legacy and V1 database URLs resolve to separate targets without exposing credentials.
4. Inspect migration markers and coarse account/data counts.
5. Confirm recent usable backup and restore path.
6. Determine whether real user data exists.
7. Record result and operator approval.

If real user data requiring preservation is found:

```text
STOP
do not reset
do not cut over
do not remove required legacy migrations/history
do not deploy replacement over data
-> create dedicated migration specification and plan
```

Clean-schema default does not imply destroying legacy data.

Isolated V1 development/staging deployments against explicitly disposable V1 databases do not require legacy production-data audit. Migration fail-closed rules and environment isolation still apply.

## 29. Scheduled Commands

Dokploy invokes bounded commands:

```text
process-recurring --batch-size N
purge-trash --batch-size N
purge-accounts --batch-size N
cleanup-auth-tokens --batch-size N
```

Commands use PostgreSQL locking/idempotency, small transactions, bounded rows, content-free logs, and nonzero exit on operational failure. Repeated or overlapping invocation is safe. Remaining work continues next schedule. Redis is not required.

## 30. Testing Strategy

Implementation follows Superpowers TDD incrementally. Each feature adds smallest meaningful tests required by specification. Test count is not goal; risk coverage is.

Required CI-blocking behavior:

- User A cannot access/infer User B data.
- Exact money parsing/calculation and no silent rounding.
- Correct income, expense, net, category aggregation, and due-only balances.
- Currencies never combine.
- Monthly calculations respect timezone.
- Budgets react to transaction create/edit/delete/restore.
- Transaction Trash invariants and purge.
- Recurring idempotency, past-start behavior, bounded catch-up, and occurrence survival after transaction purge.
- Auth verification/reset/session enumeration, expiry, revocation, and CSRF.
- Clean migrations and target safety.
- Critical browser flows.

Backend persistence behavior uses real PostgreSQL integration tests. Mocks do not replace ownership, constraints, transactions, numeric, timezone, recurrence, or migration behavior.

Frontend uses Vitest, React Testing Library where useful, and Playwright. Accessibility, cache, timezone edges, recurrence properties, and recovery are added proportionately as behavior is implemented, not as a speculative bulk test project.

Critical browser journeys cover registration/verification/login/reset, onboarding, first wallet, transaction lifecycle, history/filter/Load more, wallet/category lifecycle, budgets, recurrence, multi-currency dashboard, session expiry, restricted deletion, offline-write prevention, private-cache controls, and core accessibility.

## 31. CI/CD

V1 CI is isolated from legacy baseline.

Frontend gates:

- Format/lint.
- Typecheck.
- Vitest/component tests.
- Orval drift.
- Next.js production build.
- Critical Playwright flows.

Backend gates:

- `cargo fmt --check`.
- `cargo clippy --all-targets --all-features -- -D warnings`.
- Unit tests.
- Real PostgreSQL integration tests.
- SQLx migration verification.
- OpenAPI drift.
- Release build.

Combined gates:

- Cross-user security suite.
- Authenticated cache/header checks.
- Secret scan.
- Dependency audit.
- Container build/scan.
- Deployment configuration validation.

GitHub Actions remains CI/CD mechanism; Dokploy remains deployment platform. Existing legacy `TS7053` failure is recorded but not inherited by V1 gates.

## 32. Repository Replacement, Merge, and Production Cutover

### Phase 1 — Parallel implementation

Legacy remains runnable reference while isolated V1 implementation, database, migrations, contracts, CI, and staging deployment are built.

### Phase 2 — V1 verification

Run V1 tests, staging, security, clean migrations, backup/restore, cache/privacy, and acceptance gates. Excluded legacy features require no parity.

### Phase 3 — Preservation gate

Audit actual environment/data. Real user data requiring preservation stops replacement deployment and creates dedicated migration spec/plan.

### Phase 4 — Final repository replacement on rewrite branch

- Promote V1 to canonical `apps/web` and `apps/api`.
- Remove legacy application code.
- Remove obsolete packages/contracts/routes.
- Remove obsolete CI/config/evidence machinery.
- Retain only migration/history material required by preservation decision.
- Update documentation.
- Run complete clean-repository verification.

At completion, branch represents exactly what main should become.

### Phase 5 — Review and merge

Final PR/review, all merge gates, then merge `rewrite/cashmemo-v1`. Merge replaces repository implementation. No production route switch is prerequisite for merge.

### Phase 6 — Production deployment/cutover

After merge:

- Preserve legacy image, configuration, database, and routing record.
- Apply maintenance/write gate when needed.
- Run approved V1 migration against verified V1 target.
- Deploy V1.
- Switch routing.
- Run smoke verification.

Previous deployment remains recoverable until production verification succeeds. If V1 accepts real writes, rollback cannot silently route to stale legacy data. Stop writes, preserve both database states, and require reconciliation.

### Phase 7 — Operational cleanup

After defined stabilization period, remove legacy Dokploy services and obsolete routing/infrastructure. Retain backups/history according to preservation policy.

## 33. Readiness Gates

### 33.1 Merge-ready

- Approved V1 scope implemented.
- V1 CI green.
- Critical E2E green.
- Security/ownership tests green.
- Clean migrations verified.
- Preservation decision resolved enough to merge safely.
- Canonical repository structure complete.
- Legacy application code removed.
- Documentation updated.
- No production-blocking design issue.

### 33.2 Production-cutover-ready

- Actual environment audit complete.
- Required data migration complete if applicable.
- Recent usable backup verified.
- Restore procedure verified.
- Deployment configuration verified.
- Legacy image/configuration recorded.
- V1 production DB prepared.
- Smoke and rollback/reconciliation procedure ready.
- Operator approval recorded.

## 34. Key Decisions and Trade-offs

- **Replacement:** temporary parallel rebuild, then remove legacy before merge. Progressive replacement risks coupling; immediate reset loses reference/rollback. Temporary duplication is accepted.
- **Existing data:** clean V1 schema plus mandatory preservation gate. Full compatibility is rejected without production evidence; gate prevents destructive assumption.
- **Persistence isolation:** separate databases, URLs, and migration histories. Schema-only isolation is weaker against operator error.
- **Money:** `NUMERIC(20,4)` + `Decimal` + strings. Integer minor units are exact but add conversion/exponent boundaries; Rust pre-SQL validation prevents rounding.
- **Wallet opening balance:** wallet state. Synthetic transaction would create fake income/category and distort reporting.
- **Transaction ownership:** direct `user_id` plus composite FKs. Deriving only through wallet reduces duplication but weakens query simplicity/security constraints.
- **Authorization:** explicit user-scoped SQL + composite ownership, without baseline RLS. RLS adds pool/role/job complexity without demonstrated V1 need.
- **Sessions:** opaque PostgreSQL sessions in Secure HttpOnly cookie. JWT/localStorage is rejected for revocation and browser security.
- **Transaction deletion:** 30-day Trash, restore, explicit purge, and auto-purge. Immediate-only deletion harms recovery; indefinite Trash conflicts with minimization.
- **Account deletion:** seven-day grace, restricted login, and durable safe purge. Immediate purge harms mistake recovery; longer grace is unnecessary.
- **Wallet/category removal:** archive referenced rows and delete unreferenced rows only. Cascading delete would invalidate history.
- **Budget:** category + currency + local month with derived spent. Wallet-only or converted budget conflicts with multi-currency/no-FX rules.
- **Recurrence:** calendar rule + immutable occurrence ledger. Queue/Redis is unnecessary; deleting occurrence would permit duplicate recreation.
- **Pagination:** keyset + explicit Load more. Offset drifts; infinite scroll adds UX/error complexity.
- **Search:** escaped literal `ILIKE`. Full-text/trigram/external search is premature.
- **API:** REST `/api/v1`, Rust OpenAPI, and Orval. GraphQL and hand-maintained clients add unnecessary surface/drift.
- **Deployment:** same origin and two long-running app services. Cross-origin complicates cookies/CORS; permanent job service is unnecessary.
- **Backup:** pgBackRest + encrypted S3 + verified retention/PITR. Application-managed backup is rejected; nominal retention alone is insufficient evidence.
- **PWA:** static public assets only and private data `no-store`. Offline financial caching/sync increases privacy and correctness risk.

## 35. Material Risks and Unresolved Deployment Inputs

- Actual Dokploy/database contents remain unknown until preservation audit.
- Exact production email provider and credentials require environment confirmation.
- Production Argon2id parameters require host benchmark.
- Exact initial enabled currency subset requires reviewed registry seed; supported exponent range is fixed at 0–4.
- WAL-based RPO requires actual archive/PITR proof.
- pgBackRest retention must be validated by oldest restorable backup, not nominal days.
- `NUMERIC`/`rust_decimal`/SQLx scale behavior requires integration proof.
- Timezone and recurrence edge cases require incremental property/integration tests.
- Temporary parallel structure could become permanent without Phase 4 enforcement.
- Legacy `TS7053` typecheck failure remains unrelated baseline debt.

These items do not require legacy compatibility architecture. Production-affecting items must be resolved by deployment readiness gate.

## 36. Phase Boundary

This document completes research, repository analysis, architectural brainstorming, approved design, and written specification.

It does not authorize:

- Implementation planning.
- Application code or tests.
- Legacy code deletion.
- Production migration changes.
- Deployment.
- Route cutover.
- Merge.

Next action is written-spec review and explicit approval. Only after that approval may `superpowers:writing-plans` be invoked.
