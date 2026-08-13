# Research and Architecture Decisions: Cashmemo MVP

**Decision date**: 2026-08-09  
**Authoritative inputs**: Constitution 2.0.0, `spec.md`, requirements checklist  
**Rule**: Current requirements drove every choice. No archived implementation, tag, architecture, contract, or code was inspected.

## Evaluation Method

Each major choice was scored qualitatively against: exact Feature 001 fit, privacy/retention controls, user-confirmed truth, graceful degradation, operational reliability, implementation burden, production maturity, cost shape, testability, and replacement cost. A provider fails regardless of convenience if production training or retention controls cannot satisfy FR-084/FR-085.

Versions below are planning baselines. Implementation must pin exact package/model versions, record security review, and re-run real-provider contracts before promotion. Automatic major upgrades are forbidden.

## ADR-001 — Application Delivery

**Decision**: React 19.2 + Vite 8 client-rendered PWA, served by the monolith. Use React Router, TanStack Query, React Hook Form/Zod, Dexie/IndexedDB, and `vite-plugin-pwa` with a custom `injectManifest` service worker.

**Why it fits**:

- Private journal screens do not need SEO or server rendering. A static shell sharply limits accidental caching of financial data.
- React's ecosystem provides mature form, accessibility, browser-test, and PWA tooling; one TypeScript language permits shared generated contracts without sharing domain internals.
- IndexedDB gives asynchronous durable same-device draft recovery. Service worker code can use IndexedDB, but Feature 001 intentionally performs no general-purpose offline synchronization.
- The custom service worker can enforce network-only API/auth/audio/export routes and precache only fingerprinted public assets.

**Alternatives**:

| Alternative | Strengths | Reason not selected |
|---|---|---|
| Next.js full-stack | Integrated routing/SSR, broad hosting support | SSR and server-component caches add privacy and invalidation surfaces without product value; background jobs and restore operations still need a conventional runtime |
| SvelteKit | Smaller bundles, excellent component model | Smaller hiring/library/test ecosystem for this broad production MVP; no requirement offsets migration/training cost |
| Native iOS/Android | Best native recording integration | Explicitly out of scope; doubles clients and delays one usable product |
| Server-rendered templates/HTMX | Small client | Complex recoverable compose state, PWA recording, conflict preservation, and rich filters benefit from a dedicated client state model |

**Sources**: [React 19.2](https://react.dev/blog/2025/10/01/react-19-2), [Vite 8](https://vite.dev/blog/announcing-vite8), [`vite-plugin-pwa` service worker strategies](https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors.html), [MDN service workers and IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)

## ADR-002 — Runtime, Backend, and API

**Decision**: Node.js 24 LTS, TypeScript strict mode, Fastify 5, JSON REST under `/api/v1`, OpenAPI 3.1 as the product contract, one modular-monolith image. Role-separated workers use PostgreSQL leases from the same image.

**Why it fits**:

- Node 24 is the current LTS line and supports the browser-adjacent TypeScript toolchain.
- Project-owned modules and ports express the constitutional inward boundaries, while Fastify supplies bounded request handling and lifecycle hooks without an additional application framework.
- REST resources and state transitions are straightforward here; OpenAPI provides exact nullability, errors, and schema validation.
- A database-leased worker handles purge/export/expiry jobs with one database and one deployable system.

**Alternatives**:

| Alternative | Strengths | Reason not selected |
|---|---|---|
| Go + Chi/Fiber | Small binaries, excellent concurrency | Adds a second implementation language and duplicate money/time/contract validation for no demonstrated throughput need |
| Python + FastAPI | Fast API development, strong AI ecosystem | Node provider SDKs are mature; Python would split shared contracts and is not needed for model hosting |
| Next.js API routes | Single framework | Long-running deletion/export/restore jobs and explicit modular domain boundaries are less clear; SSR is not selected |
| GraphQL | Flexible client queries | Makes authorization, query cost, stable error semantics, caching, and export/report contract surface more complex than required |
| Separate worker service | Independent scaling | Constitution requires modular monolith; current load fits role-separated processes from the same image/release |

**Sources**: [Node.js releases](https://nodejs.org/en/about/previous-releases), [Fastify documentation](https://fastify.dev/docs/latest/)

## ADR-003 — Authentication

**Decision**: Choose session-storage option A. Embed Better Auth with its PostgreSQL adapter and use Better Auth's supported database-backed core schema and session-token semantics unchanged. Use verified email/password, Argon2id, a signed non-persisted email-verification token, hashed password-reset identifiers, Better Auth database sessions, Cloudflare Email Service in production, Mailpit in development, and Cashmemo session-bound recent-reauthentication grants. Do not claim Better Auth hashes its core session token at rest and do not build a token-hashing lookup adapter.

**Database principal topology**: Better Auth receives a dedicated PostgreSQL Pool using the `cashmemo_identity` credential (configured via `AUTH_DATABASE_URL`). This is the same PostgreSQL database but a separate database principal/connection pool. The boundary is:

```
Better Auth
    ↓
cashmemo_identity
    ↓
Better Auth-owned core authentication tables only (users, credential_accounts, sessions, verification_tokens)
```

while:

```
authenticated Cashmemo application
    ↓
cashmemo_runtime
    + transaction-local app.current_user_id
    ↓
account-owned application/domain tables
```

`cashmemo_identity` is NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, not owner of the database, not owner of the tables, unable to SET ROLE into privileged roles, and granted no journal/domain table access. This is a narrowly scoped authentication storage principal, not an admin/service bypass role.

**Exact policy**:

- Verification required before the first journal session. Better Auth 1.6.26 signs a 24-hour email-verification token without creating a verification-table row; a successful replay produces no second verification transition. Resend behavior is enumeration-safe.
- Reset link expires after one hour, is single-use, and successful reset revokes all sessions. PostgreSQL-backed `verification.storeIdentifier = "hashed"` stores the reset identifier as Better Auth's deterministic SHA-256/base64url output, not the raw reset token. Better Auth stores the internal user UUID in core `value` and atomically deletes the row on successful or expired consumption. This UUID is accepted authentication metadata protected by PostgreSQL/storage controls; it is not a token, journal content, telemetry, or evidence.
- Supported `modelName`/`fields` mappings retain plural snake-case physical names. Better Auth's boolean `users.email_verified` is the only verification authority. The required `users.name` is always the server-side non-personal value `Cashmemo account`, never requested, email-derived, displayed, or treated as Profile data; `image` remains null. Credential-only flows keep all OAuth token columns null.
- Better Auth's current official schema stores a core `token` field that is also used as the session cookie. `expiresIn=7 days`, `updateAge=1 hour`, database storage, and disabled cookie cache/secondary/stateless storage preserve supported lookup, refresh, and revocation behavior. An accepted request can extend `expiresAt`, but never later than seven days after that use.
- Cashmemo middleware checks `createdAt + 30 days` on every protected request and invokes supported revocation when reached. Better Auth internal freshness is disabled; password verification plus a separate ten-minute `ReauthGrant` gates Cashmemo-sensitive operations. This keeps recent authentication in application authorization without replacing Better Auth's session lifecycle.
- Database compromise could expose active bearer tokens because default hashing is not claimed. Mitigations are encrypted PostgreSQL storage/pgBackRest repositories, least-privilege session-table access, no token telemetry/error/evidence output, bounded expiry, supported revocation, and new Better Auth sessions after transitions that require token replacement. An isolated compatibility test must prove all configured expiry/revocation/reset behavior against the pinned Better Auth version before implementation proceeds; it does not prototype custom token hashing.
- Recent authentication means password re-verification within ten minutes for FR-088 operations.
- Email delivery events contain only provider message identifiers and coarse status; destination emails do not enter app telemetry.

**Pinned 1.6.26 core-schema compatibility matrix** (derived with `getAuthTables`/`getMigrations`, not manually inferred):

| Better Auth logical field | Cashmemo physical column | Type | Null/default | Ownership | Used in Feature 001? | Migration action |
|---|---|---|---|---|---|---|
| user.id | `users.id` | UUID | required, PostgreSQL `gen_random_uuid()` default | Better Auth | yes | add supported native-adapter default |
| user.name | `users.name` | TEXT | required, no DB default | Better Auth compatibility | internal constant only | add/backfill `Cashmemo account` |
| user.email | `users.email` | TEXT | required, unique | Better Auth | yes | convert CITEXT to normalized TEXT |
| user.emailVerified | `users.email_verified` | BOOLEAN | required, default false | Better Auth | yes, sole authority | add/backfill from timestamp; drop timestamp |
| user.image | `users.image` | TEXT | nullable | Better Auth | no | add; remain null |
| user.createdAt | `users.created_at` | TIMESTAMPTZ | required, current timestamp | Better Auth | yes | keep/map |
| user.updatedAt | `users.updated_at` | TIMESTAMPTZ | required, current timestamp/update | Better Auth | yes | keep/map |
| session.id | `sessions.id` | UUID | required, PostgreSQL `gen_random_uuid()` default | Better Auth | yes | add supported native-adapter default |
| session.expiresAt | `sessions.expires_at` | TIMESTAMPTZ | required | Better Auth | yes | keep/map |
| session.token | `sessions.token` | TEXT | required, unique | Better Auth | yes | keep unchanged/unhashed |
| session.createdAt | `sessions.created_at` | TIMESTAMPTZ | required, current timestamp | Better Auth | yes | keep/map |
| session.updatedAt | `sessions.updated_at` | TIMESTAMPTZ | required/update | Better Auth | yes | keep/map |
| session.ipAddress | `sessions.ip_address` | TEXT | nullable | Better Auth | disabled | keep null/map |
| session.userAgent | `sessions.user_agent` | TEXT | nullable | Better Auth | security metadata | keep/map |
| session.userId | `sessions.user_id` | UUID FK | required, cascade, indexed | Better Auth | yes | keep/map |
| account.id | `credential_accounts.id` | UUID | required, PostgreSQL `gen_random_uuid()` default | Better Auth | yes | add supported native-adapter default |
| account.accountId | `credential_accounts.account_id` | TEXT | required | Better Auth | yes | add/backfill from user UUID |
| account.providerId | `credential_accounts.provider` | TEXT | required | Better Auth | yes, `credential` only | keep/map |
| account.userId | `credential_accounts.user_id` | UUID FK | required, cascade, indexed | Better Auth | yes | keep/map |
| account.accessToken | `credential_accounts.access_token` | TEXT | nullable | Better Auth | no | add; assert null |
| account.refreshToken | `credential_accounts.refresh_token` | TEXT | nullable | Better Auth | no | add; assert null |
| account.idToken | `credential_accounts.id_token` | TEXT | nullable | Better Auth | no | add; assert null |
| account.accessTokenExpiresAt | `credential_accounts.access_token_expires_at` | TIMESTAMPTZ | nullable | Better Auth | no | add; assert null |
| account.refreshTokenExpiresAt | `credential_accounts.refresh_token_expires_at` | TIMESTAMPTZ | nullable | Better Auth | no | add; assert null |
| account.scope | `credential_accounts.scope` | TEXT | nullable | Better Auth | no | add; assert null |
| account.password | `credential_accounts.password_hash` | TEXT | nullable in core | Better Auth | yes for credential rows | relax NOT NULL; require populated in credential-flow tests |
| account.createdAt | `credential_accounts.created_at` | TIMESTAMPTZ | required, current timestamp | Better Auth | yes | keep/map |
| account.updatedAt | `credential_accounts.updated_at` | TIMESTAMPTZ | required/update | Better Auth | yes | keep/map |
| verification.id | `verification_tokens.id` | UUID | required, PostgreSQL `gen_random_uuid()` default | Better Auth | reset only | add supported native-adapter default |
| verification.identifier | `verification_tokens.identifier` | TEXT | required, indexed | Better Auth | reset only | add; use supported hash policy |
| verification.value | `verification_tokens.value` | TEXT | required | Better Auth | reset user UUID | add; never telemetry/evidence |
| verification.expiresAt | `verification_tokens.expires_at` | TIMESTAMPTZ | required | Better Auth | reset only | keep/map |
| verification.createdAt | `verification_tokens.created_at` | TIMESTAMPTZ | required, current timestamp | Better Auth | reset only | keep/map |
| verification.updatedAt | `verification_tokens.updated_at` | TIMESTAMPTZ | required, current timestamp/update | Better Auth | reset only | add |

With `advanced.database.generateId="uuid"`, Better Auth's supported native PostgreSQL adapter omits core IDs on insert and its official generated PostgreSQL schema supplies `pg_catalog.gen_random_uuid()` defaults. Runtime compatibility testing proved that UUID type alone is insufficient. `0003_better_auth_compat.sql` therefore adds that supported default to all four core IDs and removes unsupported `email_verified_at`, `password_changed_at`, and legacy verification `purpose`/`subject_hmac`/`token_hash`/`used_at` after deterministic conversion or safe invalidation. Existing pre-0003 verification actions are deliberately invalidated because their one-way representation cannot be losslessly converted; users can request a fresh action. Accepted migrations 0001/0002 are not rewritten.

**Alternatives**:

| Alternative | Strengths | Reason not selected |
|---|---|---|
| Amazon Cognito | Managed scale/security primitives | Custom inactivity/absolute session semantics, local development, export/deletion linkage, and predictable revocation are harder to own and test; adds another user store |
| Auth0/Clerk | Mature managed UX | Per-user financial boundary depends on a third-party identity store and provider retention/tenant configuration; recurring cost and deletion reconciliation expand |
| Supabase Auth | Integrated Postgres/RLS | Adds a platform control plane and generated API surface when only embedded auth is needed |
| Custom auth from primitives | Maximum control | Password, reset, verification, enumeration, and session edge cases are high-risk; a reviewed library plus project policy is safer |

**Sources**: [Better Auth session table, expiry, freshness, and revocation](https://better-auth.com/docs/concepts/session-management), [Better Auth database schema extensions](https://better-auth.com/docs/concepts/database), [Better Auth session options](https://better-auth.com/docs/reference/options), [Better Auth email verification/reset](https://better-auth.com/docs/concepts/email), [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Cloudflare Email Service REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)

## ADR-004 — Primary Persistence and Migrations

**Decision**: PostgreSQL 18 in the private Dokploy network; Drizzle ORM for typed queries and reviewed generated SQL migrations; forced row-level security as defense in depth. The verified development PostgreSQL 18.4 service and its persistent volume are preserved rather than recreated.

**Why it fits**:

- Transactions cover memo plus idempotency result atomically.
- Exact integer/numeric aggregation, range constraints, unique normalized label keys, JSON metadata where bounded, full-text search, row-level security, and `SKIP LOCKED` jobs fit one mature database.
- PostgreSQL deployment supplies private persistent storage and forced RLS; pgBackRest supplies encrypted full/differential backup, WAL archiving, and target-time restore with a tested maximum 35-day recovery policy.
- Drizzle stays close to SQL and can produce auditable migrations. The runtime role cannot own tables or bypass RLS.

**Alternatives**:

| Alternative | Strengths | Reason not selected |
|---|---|---|
| Appwrite | Integrated auth/database/storage | Active constitution constrains access if used but does not require it; direct relational invariants, exact reporting, RLS, migrations, and backup restore are clearer in PostgreSQL |
| DynamoDB | Managed scale/idempotency | Multi-dimensional filters, full-text search, relational label integrity, and deterministic reporting need extra indexes/services and more complex deletion |
| MongoDB | Flexible drafts | Cross-entity transactions, exact relational constraints, RLS-style isolation, and reporting are a weaker fit |
| SQLite/libSQL | Simple local operation | Production multi-user concurrency, HA, RLS, backup/restore, and background leases require more machinery |
| Prisma | Mature ORM/tooling | Drizzle exposes exact SQL and migration review with less runtime abstraction; either is viable, but one is enough |

**Sources**: [PostgreSQL 18 data types](https://www.postgresql.org/docs/18/datatype.html), [PostgreSQL row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), [PostgreSQL text-search indexes](https://www.postgresql.org/docs/18/textsearch-indexes.html), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql), [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [pgBackRest user guide](https://pgbackrest.org/user-guide.html)

## ADR-005 — Money and Currency Registry

**Decision**: Positive signed-64-bit integer minor units with separate direction; versioned registry derived from a pinned Unicode CLDR supplemental-currency release and reviewed ISO 4217 status; decimal strings at APIs/exports; all aggregate types partitioned by currency.

**Why it fits**:

- Integers eliminate binary floating-point error. A maximum of 15 significant decimal digits remains within spec while explicit overflow checks protect `BIGINT`.
- Snapshotting code, exponent, and registry version keeps historical amounts interpretable if registry rules change.
- PostgreSQL promotes `SUM(bigint)` to exact `numeric`; returning strings avoids JavaScript precision loss.

**Rejected**: floating point (inexact), arbitrary database decimal without a currency exponent (permits invalid precision), a money library as authority (hidden registry/version), and exchange-rate tables (out of scope).

**Sources**: [Unicode CLDR supplemental currency data](https://www.unicode.org/cldr/charts/47/supplemental/index.html), [CLDR currency digit behavior](https://cldr.unicode.org/development/updating-codes/update-currency-codes), [PostgreSQL aggregate return types](https://www.postgresql.org/docs/18/functions-aggregate.html)

## ADR-006 — Time Semantics

**Decision**: Store authoritative UTC instant plus the original local date-time, IANA zone, numeric offset, and tzdb version. Use Temporal-compatible parsing with ambiguity rejection; use current reporting timezone only for view-period boundaries.

**Why it fits**:

- An instant alone cannot reproduce what local time the user confirmed; a zone alone can be reinterpreted after tzdb changes. The tuple preserves both truth and display intent.
- Rejecting ambiguous/nonexistent local input forces visible resolution before confirmation.
- Half-open UTC ranges derived from local month boundaries remain DST-safe and never use the server timezone.

**Alternatives**: UTC-only loses confirmed local semantics; local-only cannot order globally; fixed offset-only cannot correctly calculate future/current zone boundaries; storing server-local timestamps violates the spec.

**Sources**: [Temporal time zones and ambiguity](https://tc39.es/proposal-temporal/docs/timezone.html), [PostgreSQL date/time types](https://www.postgresql.org/docs/18/datatype-datetime.html)

## ADR-007 — Temporary Audio

**Decision**: Stream a maximum 60-second/10 MiB recording into bounded process memory; use encrypted container-local ephemeral storage only when the adapter requires a file. Never store raw audio in RustFS, PostgreSQL, browser persistence, backups, or evidence.

**Why it fits**:

- The shortest lifecycle is safer than object storage and gives the lifecycle owner immediate delete control.
- Fargate ephemeral storage is encrypted; task destruction eliminates crash remnants. An independent minute sweeper plus hard `expires_at` handles abandoned active tasks.
- Object-store lifecycle rules are not terminal-path deletion authority and cannot enforce the one-hour raw-audio boundary.

**Supported inputs**: `audio/webm` Opus, `audio/ogg` Opus, `audio/mp4`/M4A, WAV, and MP3 after content sniffing. Unsupported/transcoded formats fail explicitly; server-side transcoding is avoided unless provider compatibility tests prove a concrete need.

**Alternatives**:

| Alternative | Reason rejected |
|---|---|
| Object-store temporary bucket | Lifecycle cannot prove one-hour deletion; backups/versioning/failed deletes enlarge evidence surface |
| PostgreSQL blob | Places raw audio in primary backups and transaction logs |
| Browser upload retention/retry queue | Leaves raw audio durable on device and creates offline-sync semantics |
| Dedicated media service | Microservice and additional operational boundary are unnecessary for 60-second payloads |

**Sources**: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [RustFS documentation](https://docs.rustfs.com/)

## ADR-008 — Speech-to-Text Provider

**Decision**: `SttPort` with initial OpenAI adapter pinned to `gpt-4o-mini-transcribe-2025-12-15` through `/v1/audio/transcriptions`. Production project must have recorded no-training/no-retention controls; the same OpenAI project is launch-gated for Zero Data Retention.

**Why selected**:

- The endpoint accepts the browser-relevant formats and the selected model is optimized for transcription.
- OpenAI documents API training opt-out by default; the transcription endpoint is eligible for the chosen controls. One vendor for STT/extraction reduces DPAs, secrets, egress policies, outage runbooks, and contract surfaces.
- At 60 seconds maximum, synchronous transcription avoids a provider-side job/file lifecycle.

**Alternatives**:

| Provider | Privacy/retention fit | Operational/cost fit | Disposition |
|---|---|---|---|
| Azure AI Speech | Real-time/fast transcription docs say audio is not retained; mature enterprise controls | Additional vendor and adapter; viable replacement | Accepted fallback, not initial |
| Google Cloud Speech-to-Text | Data logging is off by default; sync/stream processing has documented non-storage behavior | Additional vendor; strong language coverage | Accepted fallback, not initial |
| Self-hosted Whisper | Strong content control | GPU fleet, model operations, scaling, patching, and accuracy validation exceed MVP scope | Rejected for MVP |
| Browser speech APIs | Low server burden | Browser/provider behavior inconsistent, weak retention contract, poor PWA portability | Rejected |

**Blocking rule**: If signed/administrative evidence cannot prove training and provider retention disabled for the production account and endpoint, this adapter cannot launch; use a reviewed fallback.

**Sources**: [OpenAI GPT-4o mini Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe), [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data), [Azure Speech data privacy](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security), [Google Cloud STT data usage](https://cloud.google.com/speech-to-text/docs/data-usage)

## ADR-009 — AI Extraction Provider

**Decision**: `ExtractionPort` with initial OpenAI adapter pinned to `gpt-5.4-mini-2026-03-17`, `/v1/responses`, `store:false`, strict JSON Schema Structured Outputs, no tools, no files, no background mode, and only current-capture text plus locale/timezone/currency registry context.

**Why selected**:

- The pinned model supports Structured Outputs and snapshot pinning. It has enough instruction/schema capability for short money-event parsing without choosing the highest-cost model.
- Strict output is still untrusted: Zod/domain validation rejects invalid enums, amount precision, time ambiguity, and unsupported currency. Missing or contradictory fields remain explicit uncertainty, never silent coercion.
- The adapter does not send journal history, account identity, existing memos, or unrelated provider data.

**Alternatives**:

| Alternative | Strengths | Reason not selected |
|---|---|---|
| Anthropic structured/tool output | Strong extraction capability | Additional provider review/contract; no demonstrated benefit for this bounded schema |
| Google Gemini structured output | Mature structured generation | Same additional-provider cost; viable adapter fallback after privacy review |
| Deterministic parser only | No provider transmission | Cannot cover broad arbitrary phrasing/languages, though it should pre-parse obvious amounts/dates and can power manual correction |
| Self-hosted small model | Data control | Quality evaluation, serving, GPU operations, and updates are disproportionate for MVP |

**Provider limitation**: OpenAI states API data is not used to train by default, but default abuse monitoring can retain content up to 30 days. Therefore default API controls do not satisfy FR-085. Production requires approved Zero Data Retention; `store:false` alone is insufficient. Singapore offers regional storage but not guaranteed regional processing; this is disclosed, not misrepresented.

**Sources**: [GPT-5.4 mini model/snapshot/Structured Outputs](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [OpenAI data controls and ZDR](https://developers.openai.com/api/docs/guides/your-data)

## ADR-010 — Search

**Decision**: PostgreSQL full-text search using `simple` tokenization, generated `tsvector`, and GIN index, combined with relational filters and RLS. Search covers note/context and current category/Money Space names.

**Why it fits**: 10,000 memos/account is well inside PostgreSQL capability; one transactionally current index avoids another store, sync lag, deletion reconciliation, and privacy boundary. `simple` avoids language mis-stemming across user locales. Exact substring/fuzzy semantics are not promised.

**Alternatives**: OpenSearch/Elasticsearch (extra service/data copy/deletion surface), hosted Algolia (third-party financial text), client search (downloads excessive records and weak pagination), SQL `ILIKE` only (poor scalable ranking/index behavior).

**Source**: [PostgreSQL preferred text-search index types](https://www.postgresql.org/docs/18/textsearch-indexes.html)

## ADR-010A — Versioned Traversal Instead of Snapshot Pagination

**Decision**: Pair `occurred_at DESC, id DESC` keyset ordering with an account-scoped monotonic result-set version. Every cursor authenticates the version, last key, and canonical query/filter fingerprint. A continuation returns `RESULTS_CHANGED` when the current version or query binding differs.

**Why it fits**:

- Keyset ordering alone is insufficient because occurrence time is editable and create/delete/restore/archive/filter-field changes alter membership or position between browser requests.
- A database snapshot cannot safely remain open for an interactive browser traversal. Short read-consistent transactions plus version invalidation provide an honest guarantee: unchanged traversal is stable; changed traversal visibly restarts.
- One coarse account version is simple and conservative. List-affecting mutations increment it in the same transaction. Amount-only or other changes proven unable to affect membership/order may preserve it.
- Cursor carries no raw search/filter value. It contains a keyed fingerprint, version, and keyset position, and is authenticated against tampering.
- Old cursors never authorize old data. Ownership and lifecycle predicates run on every page; purged/inaccessible records are absent even if a cursor predates purge.

**Alternatives**:

| Alternative | Reason rejected |
|---|---|
| Keyset only | Stable order for an unchanged dataset, but silently omits/duplicates when sort key or membership changes |
| Offset pagination | More sensitive to insert/delete/order churn and slower at deep pages |
| Long-lived PostgreSQL snapshot | Holds transactions/resources across browser think time and complicates deployment/failover |
| Materialized per-traversal ID list | Durable query/search result copies increase storage, privacy, cleanup, and deletion-conflict complexity |
| Return purged row placeholders | Violates deletion/access rules and still cannot prove traversal completeness |

## ADR-011 — Deterministic Aggregation

**Decision**: PostgreSQL selects eligible rows and performs exact per-currency sums; pure domain functions enforce bucket completion, net, deterministic ordering, and prior-month rules. Golden data independently recomputes expected outputs from exports.

**Alternatives**: cached/materialized totals (staleness/deletion/timezone invalidation complexity at MVP scale), analytics warehouse (second database/privacy boundary), client aggregation (downloads too much and risks inconsistent semantics), AI summaries (forbidden for financial values and narrative out of scope).

## ADR-012 — Export

**Decision**: Asynchronous database-leased export job; deterministic ZIP with `manifest.json`, JSON, and CSV; private versioned RustFS Primary using its S3-compatible API; application-mediated delivery after recent auth; package expiry ≤24 hours.

**Why asynchronous**: State must expose queued/running/ready/failed/expired/canceled, retry safely, generate complete multi-file exports, and avoid request timeout at 10,000 memos. No separate queue is needed.

**Alternative**: synchronous streaming is simpler but cannot robustly expose retry/generation lifecycle or create a short-lived re-download package; email delivery would disclose/link data through another provider and is rejected.

## ADR-013 — Deletion, Backups, and Resurrection Prevention

**Decision**: Explicit row state machines plus leased purge jobs; pgBackRest full/differential backup and WAL archiving with a maximum planned 35-day recovery window; scope-specific content-free deletion-suppression ledger in separate RustFS Secondary storage; 42-day removal floor plus verified full-lineage destruction; quarterly isolated restore and pre-release re-purge.

**Why it fits**:

- Live purge and backup aging are distinct guarantees. Removing content from live stores within 24 hours does not falsely claim immediate physical erasure from encrypted backups.
- A restored database cannot know about deletions that happened after its recovery point. Each irreversible purge therefore writes `HMAC-SHA-256(suppression_key, entity_type || ":" || immutable_entity_id)` before live hard deletion. `money_memo` suppresses one individually purged record; `account` suppresses the entire restored account graph. The ledger supplies missing negative knowledge without raw IDs, email, financial value, or journal metadata.
- Forty-two days is `removal_not_before_at`, covering the maximum planned 35-day pgBackRest recovery window plus margin. It is not expiry. Removal also requires current, complete inventory proving no pgBackRest backup set/WAL, local repository, Secondary object version, manual/operator/volume copy, replica, or active isolated restore copy can resurrect pre-purge state.
- Stale, incomplete, unavailable, or unverifiable inventory keeps the token, alerts operations, and retries. Cleanup is not complete. Suppression-key versions remain available until all their tokens pass this gate.
- Deployment policy prohibits unregistered local/manual/operator/volume copies, replicas, and restore copies. Isolated restore copies are permitted only as registered, inventoried, private drill/incident resources whose verified destruction gates token removal. Production backup storage must be in an independent physical failure domain; the same-host development Secondary is only an integration target.

**Object lifecycle decision**: No object-store lifecycle or retain-until timestamp is final suppression cleanup authority. The privileged verifier explicitly removes an eligible token only after full backup-lineage proof. Ordinary exports keep bounded expiry and every-version cleanup.

**Alternatives**: account-only tokens miss individually purged memos; unlimited unverified tombstones violate minimization; time-only TTL can delete proof while an overlooked copy remains; relying only on DB tombstones fails after restoring an older snapshot; never restoring backups violates RPO/RTO; immediate backup surgery is unsupported/risky.

**Sources**: [pgBackRest user guide](https://pgbackrest.org/user-guide.html), [pgBackRest releases](https://pgbackrest.org/release.html), [RustFS releases](https://github.com/rustfs/rustfs/releases)

## ADR-014 — Observability

**Decision**: OpenTelemetry SDK/collector with project-owned allowlist event APIs and the existing shared collector/OpenObserve deployment. No session replay, request-body capture, SQL parameters, provider payload logging, or general analytics SDK. Cashmemo does not deploy a duplicate telemetry stack or depend directly on an OpenObserve SDK.

**Signals**:

- Allowed: operation code, coarse outcome/error class, duration, build, environment, availability, queue depth/oldest age, lifecycle backlog count/age, provider name/version/health, opaque rotating correlation ID.
- Forbidden: amounts, memo text, transcripts, audio, labels, search/filter values, emails, IPs in app logs, auth tokens, export data, detector inputs/matches/normalizations/derivatives, prompts/responses, raw URLs or queries.
- Boundary rule: redact/omit before the signal enters the logger/SDK. Collector-side scrubbing is defense in depth, never the primary control.

**Alternatives**: Sentry/PostHog add processors and accidental payload capture without a requirement; raw provider-specific logging lacks portable instrumentation/trace boundaries; no telemetry cannot meet operations SLOs.

**Sources**: [OpenTelemetry security](https://opentelemetry.io/docs/security/), [OpenTelemetry collector configuration security](https://opentelemetry.io/docs/security/config-best-practices/)

## ADR-015 — Deployment and Infrastructure

**Decision**: Docker + Dokploy with one immutable Cashmemo image digest serving separate API and worker roles, the existing private PostgreSQL 18 service, private RustFS Primary, separate RustFS Secondary, pgBackRest, runtime secrets injected from the existing shared Infisical service, and OTLP sent to the existing shared collector/OpenObserve. GitHub Actions performs ordered gates, image/SBOM/security publication, and produces a protected digest handoff; a separate approved Dokploy pass applies migrations/deployments and performs synthetic verification and rollback/safe-forward.

**Why it fits**: The verified development control plane already contains PostgreSQL, Infisical, and OTLP/OpenObserve. Dokploy supports conventional long-running API/worker containers without Kubernetes or independently versioned services. The architecture preserves project-owned ports and makes backup/restore, object storage, secrets, and telemetry boundaries explicit.

**Alternatives**:

| Alternative | Reason not selected |
|---|---|
| Serverless functions | Audio streaming, bounded temporary files, DB leases, connection behavior, and long deletion/export operations are more complex |
| Kubernetes | Operational burden and speculative scaling violate MVP simplicity |
| PaaS bundle (Vercel/Supabase) | Splits operational ownership, backup/restore evidence, egress, and session/deletion semantics across platforms |
| Unmanaged process deployment | Weaker repeatability, deploy rollback, role isolation, and artifact provenance |
| Microservices | Constitution conflict and no explicit need |

**Sources**: [Dokploy documentation](https://docs.dokploy.com/), [RustFS releases](https://github.com/rustfs/rustfs/releases), [pgBackRest user guide](https://pgbackrest.org/user-guide.html), [Cloudflare Email Service REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)

## ADR-016 — Test Tooling and Evidence

**Decision**: Vitest for unit/contract, fast-check for properties, PostgreSQL integration against the approved external stack, Playwright for PWA/browser journeys, axe-core plus manual accessibility, k6 for performance, real OpenAI/Cloudflare Email/RustFS/pgBackRest/Dokploy integration suites, and scripted restore/deletion drills. Evidence writer accepts only content-safe typed fields and artifact hashes. Local Docker is not required or used by this reconciliation.

**Alternatives**: mock-only tests cannot meet FR-105; a single end-to-end suite is slow and poor at invariants; manual-only evidence is non-repeatable; production financial data is forbidden in tests/evidence.

## Provider Approval Record Required Before Launch

Implementation must create a versioned decision record for each production provider with:

1. provider/legal entity, service, region/endpoint, account/project, and exact model/API snapshot;
2. data fields sent and explicit excluded fields;
3. training control and administrative proof;
4. retention setting, endpoint behavior, deletion path, and maximum provider lag;
5. data-residency/storage/processing limitations;
6. timeout, retry, rate limit, invalid-output, and outage behavior;
7. DPA/subprocessor review owner/date;
8. replacement adapter and tested fallback path;
9. real-service contract evidence hash and expiry/re-review date.

**Launch blockers as of planning**:

- OpenAI production ZDR approval and administrative evidence do not exist in this repository and must be obtained/verified during implementation. This is a known external dependency, not an unresolved architectural assumption.
- Cloudflare Email Service production sending authorization/domain verification and scoped token must be evidenced before real signup acceptance.
- No provider may be silently substituted; a new ADR and privacy gate are mandatory.

## Known Limitations Classified

| Topic | Classification | Exact statement |
|---|---|---|
| Dedicated prohibited fields/solicitation | Hard invariant | Product schemas and interfaces contain none |
| Supported detector match | Hard product control | Covered boundary is blocked before persistence/transmission |
| Arbitrary-language sensitive detection | Best-effort | Finite rules have measured false positives/negatives; no completeness claim |
| OpenAI availability/accuracy | Provider dependency | Explicit failure/uncertainty; manual path remains available |
| Same-device draft persistence | Known limitation | Browser/user/device may clear storage; server drafts improve but cannot promise offline sync |
| Live purge timing | Operational SLO | Within 24 hours under normal operation; failed required purge remains incomplete/escalated |
| Backup physical expiry | Operational SLO | Automated retention at most 35 days; scope-specific suppression remains at least 42 days and until full backup-lineage verification permits removal |
| Better Auth session token at rest | Known security characteristic | Supported database model stores core bearer `token`; no default hash claim. Encryption, least privilege, telemetry exclusion, bounded expiry, and revocation mitigate exposure |
| Core availability | Operational SLO | 99.5% monthly excluding announced maintenance |
| STT/AI interpretation | Known limitation | Draft proposal only; every field editable and explicit confirmation required |
| Singapore OpenAI processing | Provider dependency | Regional storage may be selected; processing locality is not guaranteed and is disclosed |

## Resolved Questions

All Phase 0 technical questions are resolved. Package patch versions, Dokploy resource identities, application hostname/TLS boundary, provider credentials, independent production Secondary identity, final normal-load concurrency after measurement, and human owner names are deployment configuration/assignment inputs, not product or architecture ambiguities. They must be bound before the corresponding implementation/evidence task closes.
