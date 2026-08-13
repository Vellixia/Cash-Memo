# Implementation Plan: Cashmemo MVP

**Branch**: `001-cashmemo-mvp` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)  
**Constitution**: 2.0.0 | **Architecture decision set**: `cashmemo-mvp-2026-08-09`

**Input**: Feature specification from `/specs/001-cashmemo-mvp/spec.md`

## Summary

Deliver the complete first production-usable Cashmemo product as one TypeScript modular monolith: a responsive React/Vite PWA and a Fastify HTTP application packaged in one image, backed by one PostgreSQL database. Better Auth supplies verified email/password flows and database-backed sessions inside the application boundary. Provider-neutral adapters use OpenAI's transcription and structured-output APIs only after privacy checks and explicit consent; structured manual capture never depends on either provider. Raw audio is request-owned transient material held only in bounded memory or encrypted task-local ephemeral storage, never in the database, object storage, backups, or telemetry.

The architecture makes authoritative Money Memos structurally distinct from drafts, represents money as positive integer minor units plus a versioned currency rule, stores both the authoritative occurrence instant and the user's local-time interpretation, and partitions every aggregate by currency. PostgreSQL transactions, revision checks, row-level security, caller idempotency keys, and database-leased background jobs provide isolation and retry safety without Redis, queues, microservices, or a second database.

## Technical Context

**Language/Version**: TypeScript 6.x in strict mode on Node.js 24 LTS; SQL for PostgreSQL 18; OpenAPI 3.1; Docker Compose for Dokploy handoff
**Primary Dependencies**: React 19.2, Vite 8, React Router, TanStack Query, React Hook Form, Zod, Dexie, `vite-plugin-pwa`, Fastify 5, Better Auth, Drizzle ORM, MinIO JavaScript client, OpenAI JavaScript SDK
**Storage**: PostgreSQL 18 for product and job state; browser IndexedDB for the user's same-device draft replica; encrypted container-local ephemeral space only when an STT adapter requires a temporary file; private RustFS Primary S3-compatible storage for expiring exports/approved evidence; separate RustFS Secondary for encrypted pgBackRest/WAL and content-free deletion-suppression records  
**Testing**: Vitest, fast-check, Testcontainers/PostgreSQL, Playwright, axe-core, k6, OpenAPI schema validation, real-provider smoke/contract suites, restore drills  
**Target Platform**: Docker + Dokploy using one immutable Cashmemo image with API/worker roles; existing private PostgreSQL 18; current and previous major Chrome, Edge, Firefox, and Safari on supported desktop/mobile OSes  
**Project Type**: Installable web application plus HTTP API, built and deployed as one modular-monolith image  
**Performance Goals**: p95 under 2 seconds for manual capture interactive state and core history/search/overview/review at up to 10,000 memos/account; assisted text reviewable/correction state within 10 seconds for at least 90% of normal samples; voice result/failure state within 20 seconds for at least 90%  
**Constraints**: 99.5% monthly core-journal availability SLO; 60-second recordings; raw audio hard expiry one hour; 7-day draft expiry; 30-day Recently Deleted recovery; 7-day account-deletion grace; live purge within 24 hours under normal operation; RPO 24 hours and RTO 8 hours; backups at most 35 days; WCAG 2.2 AA  
**Scale/Scope**: Initial target 10,000 registered users, 1,000 daily active users, 10,000 memos per account, 100 core requests/second burst, and 20 concurrent provider jobs; load limits are assumptions to validate before launch, not product caps

## Architecture Decisions

### Delivery and rendering

- The PWA is a client-rendered React application. The server serves versioned static assets and the manifest; all private/user-specific data crosses `/api/v1` only after server authentication.
- No user ledger content is server-rendered or put in a service-worker cache. `vite-plugin-pwa` `injectManifest` precaches immutable application-shell assets only. Navigation fallback may return the shell; API, auth, export, audio, and diagnostic routes are network-only.
- React Hook Form plus Zod owns validated form state. TanStack Query owns server state and invalidation. Draft state is not hidden inside the query cache.
- Dexie/IndexedDB holds an account-scoped, encrypted-at-rest-where-browser-capabilities-allow, same-device draft replica. It stores the exact user text, structured draft, revision, last activity, and pending idempotency key. It never stores raw audio. Logout/account switch locks or clears the replica; expiry/discard/confirmation cleanup is retried until acknowledged. Browser storage is disclosed as device-local and not guaranteed against device/browser clearing.
- Server `Draft` persistence starts when a user explicitly saves a manual/text draft or starts assisted processing. The local replica remains the conflict-preserving recovery source required by FR-041/FR-111.

### Backend and module boundaries

One Fastify process exposes the API and serves the PWA. The same image can start a worker role; API and worker are one release/deployment unit and share domain/application modules.

```text
HTTP/controller or scheduled-job adapter
                 ↓
application use case + transaction boundary
                 ↓
domain types, policies, calculations, state machines
                 ↑
project-owned ports
                 ↑
PostgreSQL, OpenAI, Cloudflare Email/Mailpit, RustFS S3-compatible, and telemetry adapters
```

Modules are `identity`, `onboarding`, `memo`, `draft`, `assisted-capture`, `labels`, `history`, `reporting`, `export`, `deletion`, `privacy`, and `operations`. A module may call another module only through an application port. Domain modules import no Fastify, Drizzle, Better Auth, OpenAI, storage-provider, deployment-platform, or browser types.

Transactions live at application-service boundaries. Each protected transaction sets a transaction-local authenticated account identifier before repository access. Jobs use PostgreSQL leases with `FOR UPDATE SKIP LOCKED`, exponential backoff, attempt limits, and idempotent state transitions. A PostgreSQL advisory lock elects one scheduler tick; no Redis, Kafka, or external workflow engine is introduced.

### Authentication and account isolation

- Better Auth is embedded with its PostgreSQL adapter; it is a library, not a separately hosted identity datastore. Email/password is the only Feature 001 login mechanism.
- Better Auth receives a dedicated PostgreSQL Pool using the `cashmemo_identity` credential (configured via `AUTH_DATABASE_URL`). This is the same PostgreSQL database but a separate database principal/connection pool. The identity pool is never exposed to the browser, never appears in evidence/telemetry, is not shared with generic repositories, and is importable only by the identity/Better Auth adapter boundary.
- Better Auth owns the core `users`, `credential_accounts`, `verification_tokens`, and `sessions` authentication fields through supported `modelName`/`fields` mappings to plural snake-case names. Cashmemo-owned `status`/`revision`, Profile, Preferences, ReauthGrant, authorization, and journal tables remain outside Better Auth's lifecycle.
- Better Auth's boolean `emailVerified` mapped to `users.email_verified` is the sole email-verification authority. The former `email_verified_at` timestamp is migrated into that boolean and removed. Better Auth's required `name` receives the fixed server-side compatibility value `Cashmemo account`; signup never asks for a name, the value is not derived from email, is not profile data, and is never displayed. `image` remains nullable and unused.
- Email verification is required before a journal session is issued. Cloudflare Email Service sends generic, short-lived verification and reset links in production; email bodies contain no financial content. Development uses Mailpit. Cloudflare real-service closure remains blocked until approved configuration exists.
- Passwords use Argon2id through Better Auth's custom hash/verify callbacks. Better Auth's native PostgreSQL UUID mode owns core IDs and relies on `pg_catalog.gen_random_uuid()` defaults for `users`, `sessions`, `credential_accounts`, and `verification_tokens`; domain UUIDv7 rules do not override these library-owned IDs. Better Auth's 24-hour email-verification token is signed and not persisted in `verification_tokens`; replay after successful verification cannot perform another verification transition. Password-reset identifiers use supported PostgreSQL-backed `verification.storeIdentifier = "hashed"`, expire in one hour, are atomically consumed/deleted, return enumeration-safe request responses, and revoke every session on successful reset. The stored reset `identifier` is Better Auth's SHA-256/base64url result, while core `value` is the internal user UUID; neither field is telemetry or evidence. No raw verification/reset token is stored.
- `credential_accounts.provider = "credential"` is the only enabled provider. Better Auth's structurally required OAuth access/refresh/ID-token, expiry, and scope columns remain nullable and must stay null in signup, login, verification, and reset tests. No social provider is configured.
- Better Auth owns session creation, lookup, refresh, and revocation through its supported database-backed session model. Its core `token` value is the same token used by the session cookie and is stored as Better Auth supports; Cashmemo does not claim default hashing and does not interpose a custom token-lookup adapter. PostgreSQL volume/repository encryption, least-privilege table access, encrypted backups, and strict telemetry exclusion protect this bearer material at rest. Cookie caching, secondary session storage, and stateless sessions are disabled; the Better Auth-generated token is sent only in a `Secure`, `HttpOnly`, `SameSite=Lax`, host-only cookie.
- Better Auth is configured with `expiresIn=7 days` and `updateAge=1 hour`, so its supported `expiresAt` refresh is never later than seven days after the last accepted use. Cashmemo middleware additionally rejects and revokes a session when `createdAt + 30 days` is reached, even if Better Auth refreshed `expiresAt`. Better Auth `freshAge` is disabled because Cashmemo uses explicit password verification plus a separate session-bound, ten-minute `ReauthGrant`; supported Better Auth revoke-current/revoke-other/revoke-all operations remain the only session lifecycle mechanism. Password reset revokes all sessions. Session-token rotation is obtained by revoking the old session and issuing a new Better Auth session when a transition requires it, not by mutating Better Auth's token field.
- Sign-out revokes the current row; “sign out other sessions” revokes all rows except the current row. Password reset and account deletion revoke all.
- Sensitive operations require a session-bound reauthentication grant created by password verification, valid for ten minutes and single-account only. It gates export download, purge, account deletion, session revocation, and sensitive preference changes.
- PostgreSQL `FORCE ROW LEVEL SECURITY` policies and a non-owner runtime role provide defense in depth. The API never accepts `user_id`/`account_id` in protected resource payloads.

### Persistence, concurrency, and idempotency

- PostgreSQL 18 is the only primary datastore. Drizzle emits reviewed SQL migrations; production never uses schema `push`. Accepted migrations `0001_cashmemo_mvp.sql` and `0002_roles_rls.sql` remain immutable. Forward migration `0003_better_auth_compat.sql` reconciles Better Auth core identity columns and invalidates only outstanding pre-0003 verification actions that cannot be losslessly converted. `0004_identity_access_boundary.sql` introduces a dedicated `cashmemo_identity` database principal for Better Auth pre-auth operations, narrowly scoped to the four Better Auth core tables plus signup-scoped idempotency access. `cashmemo_runtime` access to `sessions`, `credential_accounts`, and `verification_tokens` is revoked. The later search projection is `0005_search_projection.sql`.
- Mutable resources carry monotonically increasing `revision BIGINT`. Updates use `WHERE id=? AND revision=?`, increment within the transaction, and return `REVISION_CONFLICT` with content-free reload guidance if zero rows update. No silent merge or last-write-wins path exists.
- `IdempotencyRecord` is scoped to `(account_id, operation, key)`. It stores a canonical request HMAC, status, resource/result reference, and expiry, never request content. Same key plus same HMAC returns the original status/result; same key plus different HMAC returns `IDEMPOTENCY_CONFLICT`; an in-progress retry returns `OPERATION_IN_PROGRESS`. Creation and assisted confirmation commit the authoritative memo and result record in one transaction.
- History and Recently Deleted use keyset pagination ordered by `occurred_at DESC, id DESC`, plus one account-scoped monotonic `HistoryListState.version`. First-page responses return the version. Continuation cursors are opaque authenticated values containing that version, the last keyset position, and an HMAC of the canonical query/filter state—never raw search terms. The server recomputes the fingerprint; query mismatch or current-version mismatch returns `RESULTS_CHANGED` and no page.
- Memo create, delete, restore, archive/active membership change, purge, occurrence edit, and any note/direction/currency/category/Money-Space/purpose/planning mutation that can change a history/search traversal increment the list version in the same transaction. Amount-only or other changes proven unable to affect membership/order may preserve it. Label rename/status changes that affect searchable/filterable membership also increment it. Each page request uses only a short read-consistent transaction for version check plus page query; no snapshot survives the request. A concurrent change after a page causes the next continuation to fail closed and restart. Purged, deleted outside the requested recovery view, cross-user, or otherwise inaccessible records are never replayed for cursor continuity.

### Exact money model

- The supported registry is a reviewed, versioned allowlist derived from a pinned Unicode CLDR supplemental-currency release and cross-checked against ISO 4217 status. A registry entry defines canonical uppercase code, decimal exponent, enabled state, display metadata, and registry version. There are no rate or conversion fields.
- Product input uses `{ currency: "IDR", amount: "85000" }`, where `amount` is a canonical non-negative decimal string. JSON numbers are rejected. The boundary parser checks a strict decimal grammar, positive magnitude, enabled currency, exact registry precision, and at most 15 significant digits, then converts to an integer `amountMinor`.
- Persistence uses positive `amount_minor BIGINT`, `currency_code CHAR(3)`, `currency_exponent SMALLINT`, and `currency_registry_version`. Direction is a separate enum. The maximum is the smaller of 15 significant decimal digits and signed 64-bit capacity after scaling; overflow is rejected before SQL.
- API responses and exports include both canonical decimal `amount` and decimal-string `amountMinor`; neither is a JSON number. The exponent and registry version are included for durable interpretation.
- SQL aggregates use `SUM(amount_minor)` (PostgreSQL `NUMERIC` result), group by `(currency_code, currency_exponent)`, and serialize totals as strings. Reporting APIs return an array of currency sections. No application function accepts a heterogeneous money list and returns one scalar.

### Exact time model

- A memo stores `occurred_at TIMESTAMPTZ` (authoritative instant), `occurred_local TIMESTAMP WITHOUT TIME ZONE`, canonical IANA `occurred_timezone`, `occurred_offset_minutes`, and the tzdb release used to validate it.
- API input/output supplies RFC 3339 `occurredAt`, ISO local `occurredLocal`, IANA `occurredTimezone`, and integer offset minutes. The server recomputes and validates the tuple with Temporal semantics. Nonexistent/ambiguous local input returns alternatives; the user must explicitly choose before confirmation. Existing memos retain their instant, local value, zone, and offset when preferences change.
- Relative assisted dates resolve from immutable `capture_started_at` in the account's then-current reporting timezone. Month queries construct `[local month start, next local month start)` and convert both boundaries to UTC. Database and process default timezone remain UTC.

### Natural-language, voice, and provider trust boundary

Typed flow:

```text
exact local text → client detector → server detector → explicit consent
→ extraction adapter → strict schema/result validation → non-authoritative draft
→ user review/edit → domain validation → idempotent explicit confirmation → Money Memo
```

Voice flow:

```text
explicit start + 60-second client stop → bounded raw stream
→ request-owned temporary audio → explicit STT consent → STT adapter
→ immediate audio destruction → transcript detector
→ editable/incomplete transcript → explicit AI consent → extraction adapter
→ strict schema/result validation → editable draft → explicit confirmation → Money Memo
```

- Browser-supported recording input is WebM/Opus where available, with Ogg/Opus, MP4/M4A, WAV, or MP3 accepted after MIME, magic-byte, duration, and 10 MiB limits. Server never trusts client duration metadata.
- Raw audio is never placed in PostgreSQL or RustFS. It is held in bounded process memory; if the selected SDK needs a file, the lifecycle owner writes it to encrypted container-local ephemeral storage with an opaque random path. `try/finally`, cancellation handling, a one-minute sweeper, process-start sweep, and container termination enforce deletion. Metadata contains no transcript/audio content. A 60-minute `expires_at` is the hard fallback, while terminal-path deletion targets five minutes.
- `SttPort` returns a project-owned transcript result; `ExtractionPort` returns a project-owned candidate schema. The selected adapters call pinned `gpt-4o-mini-transcribe-2025-12-15` and `gpt-5.4-mini-2026-03-17`, respectively. Extraction uses `/v1/responses`, `store:false`, no tools, no files, no background mode, and strict structured output.
- Production use requires an approved OpenAI project with Zero Data Retention, training opt-out, endpoint/model eligibility, provider agreement, and recorded regional-processing limitation. Missing approval blocks launch; the ports permit replacing either adapter without domain changes.
- Provider timeouts, rate limits, invalid JSON/schema, ambiguous fields, and confidence gaps become explicit capability states. They never create or mutate a confirmed memo. Manual structured entry remains available against core services.

### Privacy controls

- `PrivacyBoundaryPort` applies versioned detector rules in browser and server implementations. The server implementation is authoritative. Rule-set v1 covers Luhn-valid card-number patterns, IBAN structure/checksum, CVV/CVC/PIN/OTP or access-secret labels adjacent to candidate values, labeled bank-account/token/passcode values, and labeled Indonesian NIK/passport-like values. Exact rules, fixtures, languages, false positives, and false negatives are versioned.
- Covered boundaries are device draft persistence, server draft persistence, typed-text provider transmission, transcript persistence, transcript-to-AI transmission, label/note persistence, search submission, and support/evidence capture. Audio must reach the explicitly consented STT operation before speech can become detectable text; immediately after transcription, the transcript detector runs before persistence or AI. This unavoidable provider dependency is disclosed and the STT request contains only the current recording.
- A match blocks the boundary, shows guidance, retains no matched value on the server, and requires the user to remove it or abandon the capture. The browser may keep the unsent value only in live form memory so the user can edit it; it is not put in IndexedDB.
- Telemetry is allowlist-first at the instrumentation call site. Only stable operation code, coarse outcome, duration bucket, service health, queue depth, build/version, and opaque correlation identifiers are accepted. The logger/OTel adapters have no general object/body serialization API. Request/response bodies, URL queries, provider payloads, DOM/session replay, and database statement parameters are disabled.
- Privacy canary tests seed unique values through every boundary and scan logs, metrics, traces, client errors, evidence, and unrelated provider captures for zero occurrence. Detector candidates and derivatives are never included even in test failure output.

### Search and deterministic reporting

- PostgreSQL full-text search uses the `simple` configuration over an account-owned generated search vector for note/context plus current label names, with a GIN index. Search input is a bound parameter, never URL or telemetry data. Prefix/fuzzy semantic search is out of scope.
- Every query constrains the authenticated account before applying date, direction, category, Money Space, purpose, planned status, currency, and lifecycle filters. RLS independently enforces the same account.
- Reporting executes deterministic SQL/application calculations over confirmed, non-deleted rows, including archived rows. Currency is the first grouping key; category/purpose/planning buckets each account for eligible values exactly once. Golden datasets are the reference oracle.
- Prior-month comparison uses the same reporting-zone boundaries and currency. Percentage is omitted when prior value is zero; absolute change and reason are returned. No AI narrative enters reporting.

### Export and deletion

- Export is asynchronous because completeness, packaging, and evidence must be retry-safe. A DB-leased job creates a deterministic ZIP containing `manifest.json`, versioned JSON, and CSV files for preferences, labels, memos, recoverable drafts, and lifecycle metadata. Rows use immutable IDs and stable ordering; timestamps, currency fields, states, and schema/registry versions are explicit.
- Export objects live in a private versioned RustFS Primary bucket under opaque account-scoped keys. Application-mediated download follows recent authentication and account scope; no public object URL is exposed. The package expires within 24 hours, and cancellation/expiry queues every object version/delete marker for deletion within 24 hours.
- Record state is `active|archived|recently_deleted|purging|purged`. Recently Deleted retains `prior_state`, `deleted_at`, and `purge_after` for 30 days. Purge removes live content and related draft/provider state, then retains only content-free deletion evidence.
- Account state is `active|deletion_grace|purging|purged|purge_failed`. During seven-day grace, journal access is suspended; cancellation is allowed. Once `purging` starts it is irreversible. Jobs are idempotent and incomplete required purges never report completion.
- Before an irreversible purge deletes live content, the deletion owner durably writes a scope-specific ledger record to RustFS Secondary, outside the PostgreSQL/pgBackRest resurrection set. Its identity is `deletion_token = HMAC-SHA-256(suppression_key, entity_type || ":" || immutable_entity_id)`, with `entity_type` at minimum `money_memo|account`. The ledger stores only token, entity type, suppression-key version, purge time, `removal_not_before_at`, policy version, and content-free verification state—never raw account/memo ID, email, financial value, journal metadata, or content derivative. Failure or ambiguity leaves the entity inaccessible in `purging` and blocks irreversible live deletion.
- `removal_not_before_at` is purge time plus 42 days (35-day maximum planned backup window plus seven-day margin), not an expiry or deletion command. After that time, a privileged verifier must prove every pgBackRest backup/WAL recovery window is closed and no local repository, Secondary object version, manual/operator/volume copy, replica, or active isolated restore copy can restore pre-purge state. Only then may it delete the token. Stale, incomplete, unavailable, or unverifiable inventory retains the token, raises an alert, and retries.
- Deployment policy prohibits unregistered local/manual/operator/volume backup copies, unregistered replicas, and unregistered restore copies. Isolated restore copies are permitted only when registered, private, inventoried, and verified destroyed before suppression cleanup. RustFS lifecycle is never deletion-ledger authority. Production backup storage must be an independent physical failure domain; the same-host development Secondary cannot close SC-021.
- Restore tooling computes tokens for restored account and Money Memo immutable IDs across active suppression-key versions, suppresses exact matches before network release, then verifies absence. Account tokens remove the whole restored account graph; memo tokens remove only the exact individually purged memo and related state. Suppression keys remain available until every record created under their version passes verified cleanup.

### Deployment, observability, and recovery

- Dokploy deploys the same immutable Cashmemo digest as private API and worker roles. It preserves the existing PostgreSQL service and volume, deploys private RustFS Primary and Secondary plus pgBackRest, and connects—not duplicates—the shared Infisical and OTel/OpenObserve services. Public proxy/tunnel configuration remains outside this feature.
- GitHub Actions builds a pinned, non-root, read-only-root-filesystem-capable OCI image; runs gates in constitutional order; generates an SBOM; scans dependencies/image/secrets; and publishes an immutable digest plus protected deployment handoff. A separate approved Dokploy pass applies migrations and services, verifies health, and runs synthetic acceptance. Backward-compatible expand/contract migrations permit rollback; otherwise safe-forward recovery is mandatory and rehearsed.
- Existing shared Infisical supplies runtime secrets by environment injection. Application modules do not depend on an Infisical SDK. Missing production-equivalent secret names fail startup without logging values.
- OpenTelemetry emits allowlisted signals through the shared collector into OpenObserve. Alarms cover core availability/latency/error rate, provider health separately, DB saturation, worker backlog/lease age, deletion/audio/export expiry, email failures, and backup/restore status.
- pgBackRest full/differential backups and WAL archiving target RPO ≤24 hours. Quarterly isolated target-time restore drills target RTO ≤8 hours and verify RLS isolation, exact account- and memo-token suppression, money/currency integrity, deterministic totals, export isolation, restore-copy destruction, and safe release. RustFS Primary export/evidence buckets use versioning and scoped lifecycle policies; suppression-ledger removal is verifier-controlled rather than TTL-controlled, and raw audio is absent from all durable stores.

## Constitution Check

### Before Phase 0

| Principle | Result | Planning evidence |
|---|---|---|
| I. Privacy by Default | PASS | No dedicated prohibited fields; finite pre-boundary controls; best-effort limits; adjacent guidance; allowlist telemetry and provider minimization |
| II. User-Confirmed Truth | PASS | Draft and confirmed entities/state machines are separate; only explicit idempotent confirmation creates a Money Memo |
| III. Temporary Audio | PASS | Request-owned memory/ephemeral storage, one-hour hard expiry, independent sweeper, four-path tests, no backup/object storage |
| IV. Graceful Degradation | PASS | Structured manual CRUD and core API have no STT/AI/cache dependency |
| V. Data Ownership | PASS | Versioned export; lifecycle per data class; 30-day record recovery; deletion jobs, provider tracking, and backup suppression |
| VI. Architecture Discipline | PASS | One modular monolith; domain-inward dependencies; every external service behind a project port. Appwrite is not selected, so its access restriction is not invoked |
| VII. Reliability | PASS | Caller keys, canonical HMAC, transactionally stored results, revision conflicts, local/server draft recovery, explicit partial/failure states |
| VIII. Security | PASS | Zod/OpenAPI/provider validation, authenticated ownership, RLS defense in depth, runtime secrets, fail-closed middleware |
| IX. Quality Gates | PASS | Test strategy covers ordered gates, real providers, privacy boundaries, story evidence, lifecycle paths, and completion ownership |
| X. Scope Discipline | PASS | No bank features, advice, microservices, external queue/cache, second database, Kubernetes, or offline synchronization |

**Pre-research gate**: PASS. The active constitution's Appwrite/Redis references were treated only as constraints if those technologies are selected; neither is selected or required.

### After Phase 1

| Check | Result |
|---|---|
| All domain dependencies point inward | PASS |
| Manual operation has no provider dependency | PASS |
| Money/time/currency invariants are represented in schemas and contracts | PASS |
| Every provider is replaceable and production privacy-gated | PASS |
| Draft/audio/confirmed/deletion states cannot be confused structurally | PASS |
| Exact lifecycle and evidence ownership exists | PASS |
| No constitutional exception is required | PASS |

**Post-design constitution gate**: PASS. No C-07 or other feature exception exists.

## Planned Project Structure

No source directories are created by this planning run. Implementation should create this structure:

```text
apps/
├── web/
│   ├── src/{app,features,components,forms,drafts,privacy,pwa}/
│   └── tests/{unit,component,pwa}/
└── server/
    ├── src/
    │   ├── modules/{identity,onboarding,memo,draft,assisted-capture,labels}/
    │   ├── modules/{history,reporting,export,deletion,privacy,operations}/
    │   ├── adapters/{http,postgres,openai,rustfs,backup,cloudflare,mailpit,telemetry}/
    │   └── bootstrap/{api,worker}/
    └── tests/{unit,integration,contract,privacy}/
packages/
├── domain/             # pure entities, value objects, policies, calculations
├── contracts/          # generated/shared types from the approved OpenAPI source
├── currency-registry/  # pinned versioned currency data and exact parsers
├── privacy-rules/      # detector definitions and content-safe result types
└── test-support/       # synthetic fixtures; never production content
tests/
├── acceptance/         # Playwright story journeys and evidence writer
├── providers/          # real OpenAI, Cloudflare Email, RustFS, PostgreSQL, and pgBackRest tests
├── performance/        # k6 normal-load profiles
├── security/           # isolation, abuse, and authorization suites
└── operations/         # restore, purge, expiry, rollback exercises
infra/
├── opentofu/{modules,environments}/
└── containers/
ops/
├── runbooks/
├── drills/
└── evidence/
```

**Structure Decision**: A TypeScript workspace supports shared schemas and value objects while preserving module boundaries. Web and server are build-time projects but one production artifact/deployment. Infrastructure and operational evidence remain reviewable beside the feature without becoming a separate service.

## Delivery Sequence

1. Establish workspace, generated-contract workflow, currency/time/privacy value objects, local PostgreSQL, and CI gate order.
2. Deliver identity, onboarding, starter labels, sessions, RLS, manual drafts, confirmed memos, lifecycle, retries, and conflicts.
3. Deliver history/search/filters plus exact current-month and monthly reporting.
4. Deliver typed extraction and voice/STT through privacy-gated adapters, preserving manual degradation.
5. Deliver export, Recently Deleted, account deletion, deletion reconciliation, backup/restore, and operational evidence.
6. Deliver PWA installability/accessibility, observability, deployment/rollback, performance, real-provider, and full production-equivalent journey evidence.

This is sequencing guidance only; `/speckit.tasks` owns task decomposition and has not run.

## Complexity Tracking

No constitution violation or complexity exception is required.

| Candidate complexity | Disposition |
|---|---|
| Separate queue/cache | Rejected; PostgreSQL leases satisfy current retry and scheduled-work requirements |
| Separate audio object store | Rejected; encrypted request-local lifecycle better satisfies one-hour maximum and backup exclusion |
| Separate search engine | Rejected; PostgreSQL full-text search meets 10,000-memo scope and isolation needs |
| Multiple deployed services | Rejected; API, static PWA, and worker roles remain one codebase/image/release unit |
| SSR framework | Rejected; the private application gains no required SSR value and would enlarge caching/privacy boundaries |

## Planning Completion Gate

Planning is complete only when:

1. `research.md`, `data-model.md`, `quickstart.md`, `test-strategy.md`, contracts, and operational planning exist and agree with this plan.
2. There are no unresolved-marker tokens, template placeholders, cross-currency scalar paths, provider-specific domain types, or unowned data lifecycles.
3. Constitution re-check passes with no exception.
4. The configured mandatory `after_plan` quality gate passes.
