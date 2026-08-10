# Tasks: Cashmemo MVP

**Input**: Authoritative design artifacts under `specs/001-cashmemo-mvp/` plus `.specify/memory/constitution.md` and `.specify/feature.json`
**Scope**: Complete production-usable Feature 001; no partial foundation is an MVP
**Tests**: Test-first and evidence-first ordering is mandatory per `test-strategy.md`
**Authority**: Constitution 2.0.0; no feature exception

## Format: `[ID] [P?] [Story] Deliverable with exact path`

- **[P]** means task is parallel-safe only after declared prerequisites complete; marked tasks use different files and shared mutable state.
- **[USx]** identifies user-story ownership. Cross-cutting setup, infrastructure, and release tasks have no story label.
- Every task produces implementation, test, migration, infrastructure, procedure, or content-safe evidence that can be checked independently.
- Tests/harnesses precede implementation. Fake providers aid deterministic development but never close real-service requirements.
- No task may inspect or reuse archived Feature 001 material.

---

## Phase 1: Repository and Toolchain Foundation

**Purpose**: Reproducible workspace, local production-like boundary, and blocking gate skeleton.

- [x] T001 Pin Node.js 24 LTS, Corepack, pnpm, workspace packages, and frozen dependency baseline in `.tool-versions`, `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`
- [x] T002 Create planned modular-monolith workspace entry points, strict shared TypeScript configuration, and minimal executable/testable `apps/web` React/Vite/Vitest foundation in `apps/web/tsconfig.json`, `apps/server/tsconfig.json`, `packages/tsconfig.json`, `tsconfig.base.json`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/app/router.tsx`, `apps/web/tests/setup.ts`, and `playwright.config.ts` — REOPENED: extend to include minimal web application scaffold required by T058–T060/T062–T063
- [x] T003 [P] Configure formatting and linting with zero-warning CI behavior in `prettier.config.mjs` and `eslint.config.mjs`
- [x] T004 [P] Define fail-closed runtime configuration schema and safe-name-only example variables in `.env.example` and `apps/server/src/bootstrap/environment.schema.ts` (FR-083) — REOPENED: add AUTH_DATABASE_URL for dedicated identity database principal
- [x] T005 [P] Provide HTTPS local PostgreSQL 18, Mailpit, object fake, and OpenTelemetry sink bootstrap in `infra/containers/compose.yaml` and `scripts/local/bootstrap-https.mjs`
- [x] T006 [P] Define pinned non-root, read-only-root-filesystem development/production image baseline in `infra/containers/Dockerfile`
- [x] T007 [P] Configure secret and secret-like-value scanning without printing suspected values in `.gitleaks.toml` and `.github/workflows/secret-scan.yml` (FR-083)
- [x] T008 [P] Create constitutional CI gate skeleton with fail-fast order format/lint → typecheck/drift → unit/property → integration/contract → privacy/security → acceptance in `.github/workflows/verify.yml` (FR-117)
- [x] T009 [P] Configure exact patch-version review, license policy, dependency audit, image scan, and SBOM generation in `.github/dependabot.yml` and `.github/workflows/supply-chain.yml`
- [x] T010 [P] Encode inward dependency and one-image modular-monolith boundaries in `dependency-cruiser.config.mjs` and `tests/architecture/module-boundaries.spec.ts` (Constitution VI)
- [x] T011 [P] Define synthetic-only fixture policy, safe fixture IDs, and production-data rejection in `packages/test-support/src/fixtures/policy.ts` and `packages/test-support/tests/fixture-policy.spec.ts`
- [x] T012 Register every planned verification and acceptance command—including `pnpm acceptance:us1` through `pnpm acceptance:us8` and `pnpm acceptance:full-mvp`—with fail-closed real-service modes in `package.json` and `scripts/verify/run-gates.mjs` (FR-117, FR-118)

**Checkpoint**: Clean clone can install, validate environment names, start local dependencies, and expose ordered empty gates without production credentials.

---

## Phase 2: Shared Contracts, Domain, and Test Foundation

**Purpose**: Provider-neutral schemas, exact money/time rules, safe errors/evidence, and reusable test controls.

- [x] T013 [P] Add OpenAPI 3.1 lint, example validation, operation security/error coverage, and provider-type exclusion tests in `apps/server/tests/contract/openapi.contract.spec.ts` (FR-080)
- [x] T014 Generate deterministic server/client contract types and drift checks from `specs/001-cashmemo-mvp/contracts/openapi.yaml` into `packages/contracts/src/generated/` using `packages/contracts/openapi-codegen.config.mjs`
- [x] T015 Implement stable privacy-safe product error codes and HTTP mappings without echoed input/provider data in `packages/domain/src/errors/product-error.ts` and `apps/server/src/adapters/http/error-mapper.ts` (FR-008, FR-049, FR-089)
- [x] T016 [P] Write money parser, precision, sign, zero, overflow, registry, serialization, and 10,000-case property contracts in `packages/domain/tests/money.property.spec.ts` (FR-013, FR-014; SC-005)
- [x] T017 Build pinned CLDR/ISO-reviewed versioned supported-currency registry with no exchange-rate fields in `packages/currency-registry/src/registry.ts`, `packages/currency-registry/data/registry-v1.json`, and `packages/currency-registry/REVIEW.md` (FR-015)
- [x] T018 Implement positive integer-minor-unit Money value object, decimal-string API serialization, and currency-partitioned collection types in `packages/domain/src/money/money.ts` (FR-013–FR-017)
- [x] T019 [P] Write occurrence tuple, future-bound, relative-anchor, reporting-zone, DST gap/repetition, and generated-zone contracts in `packages/domain/tests/occurrence.property.spec.ts` (FR-018–FR-021)
- [x] T020 Implement authoritative instant plus local/IANA/offset/tzdb occurrence semantics and half-open month boundaries in `packages/domain/src/time/occurrence.ts` and `packages/domain/src/time/reporting-period.ts` (FR-018–FR-021)
- [x] T021 [P] Write Money Memo, draft, audio, export, and account lifecycle transition property tests in `packages/domain/tests/lifecycle.property.spec.ts`
- [x] T022 Implement typed lifecycle state machines that structurally separate authoritative memos from drafts/provider/audio state in `packages/domain/src/lifecycle/state-machines.ts` (Constitution II, III, V)
- [x] T023 [P] Write revision compare-and-set and idempotency replay/conflict property contracts in `packages/domain/tests/reliability.property.spec.ts` (FR-023, FR-029, FR-047)
- [x] T024 Implement revision, canonical request HMAC, retry-result, and deterministic job-key primitives in `packages/domain/src/reliability/primitives.ts` (Constitution VII)
- [x] T025 [P] Define non-content-bearing privacy results, boundary enums, warning codes, and project-owned `PrivacyBoundaryPort` in `packages/privacy-rules/src/contracts.ts` (FR-075–FR-077)
- [x] T026 [P] Write compile/runtime tests for allowlisted diagnostic event builders that cannot accept bodies, arbitrary objects, query values, secrets, or detector material in `packages/domain/tests/telemetry-event.spec.ts` (FR-078, FR-079)
- [x] T027 [P] Write typed evidence-writer rejection, quarantine, manifest-schema, and canary tests in `packages/test-support/tests/evidence-writer.spec.ts` (FR-104, FR-118, FR-119)
- [x] T028 Implement content-safe evidence writer and hash-only artifact manifest in `packages/test-support/src/evidence/evidence-writer.ts` and `ops/evidence/README.md` (FR-118, FR-119)
- [x] T029 [P] Provide deterministic clock, timezone, tzdb-version, and deadline controls in `packages/test-support/src/time/controlled-clock.ts`
- [x] T030 [P] Implement strict project-port STT, extraction, email, object-store, and telemetry fakes in `packages/test-support/src/providers/fakes.ts`
- [x] T031 [P] Build reusable two-account isolation, fault-proxy, lost-response, duplicate-delivery, and provider-capture harnesses in `packages/test-support/src/harness/index.ts` (FR-082, FR-111)

**Checkpoint**: Shared contracts and invariants fail before dependent application behavior exists; evidence tooling cannot encode user content.

---

## Phase 3: PostgreSQL and Persistence Foundation

**Purpose**: Reviewed schema/migrations, forced RLS, transaction-local ownership, jobs, and real PostgreSQL test substrate.

- [x] T032 Reconcile schema-to-data-model contract tests for all 24 persistent model types, including Better Auth-owned User/CredentialAccount/Verification/Session fields, compatibility-only null fields, constraints, indexes, and authority separation in `apps/server/tests/contract/database-schema.contract.spec.ts`
- [x] T033 [P] Reconcile User, CredentialAccount, VerificationToken, Better Auth Session, ReauthGrant, Profile, Preferences, Category, and MoneySpace declarations with pinned Better Auth 1.6.26 model/field mappings in `apps/server/src/adapters/postgres/schema/identity-labels.ts`
- [x] T034 [P] Declare authoritative MoneyMemo plus ComposeDraft, AssistedCapture, ProviderAttempt, and TemporaryAudioMetadata tables in `apps/server/src/adapters/postgres/schema/journal-capture.ts`
- [x] T035 [P] Declare IdempotencyRecord, ExportJob, AccountDeletion, ProviderDeletion, and BackgroundJob tables in `apps/server/src/adapters/postgres/schema/operations.ts`
- [x] T036 [P] Declare currency registry, ContentFreeMutationAudit, and HistoryListState tables/indexes without exchange-rate or free-form operational columns in `apps/server/src/adapters/postgres/schema/reference-audit-history.ts`
- [x] T037 Generate, review, and commit initial PostgreSQL 18 schema migration with exact checks, composite ownership FKs, GIN indexes, and checksums in `apps/server/src/adapters/postgres/migrations/0001_cashmemo_mvp.sql`
- [x] T038 Add non-owner runtime/migration/worker/restore roles plus `FORCE ROW LEVEL SECURITY` policies for every account-owned table in `apps/server/src/adapters/postgres/migrations/0002_roles_rls.sql` (FR-010, FR-081)
- [x] T039 [P] Create PostgreSQL 18 Testcontainers and Mailpit/object-fake integration harness in `apps/server/tests/integration/support/test-environment.ts`
- [x] T040 Write missing/forged/cross-user/pool-reuse transaction-context tests before repository code in `apps/server/tests/integration/transaction-account-context.spec.ts` (FR-010, FR-081) — REOPENED: extend to cover pre-auth identity role, runtime role, pool reuse, role isolation, and forbidden cross-role access
- [x] T041 Implement parameterized transaction-local authenticated-account context and fail-closed repository unit-of-work in `apps/server/src/adapters/postgres/transaction-context.ts` (FR-010, FR-081)
- [x] T042 Create/review `apps/server/src/adapters/postgres/migrations/0003_better_auth_compat.sql` and `0004_identity_access_boundary.sql` without modifying 0001/0002, then verify empty 0001→0002→0003→0004 and representative accepted pre-0003 forward migration, checksums, safe-forward, registry, constraints, and RLS in `apps/server/tests/integration/migrations.spec.ts` and `scripts/db/verify.mjs` — REOPENED: add 0004 identity access boundary migration and verify full chain
- [x] T043 Create guarded synthetic seed with two isolated accounts, starter labels, multi-currency/timezone golden rows, drafts, and lifecycle states in `apps/server/src/adapters/postgres/seeds/synthetic.ts`
- [x] T044 Write job lease, crash/reclaim, dedupe, backoff, dead-letter, and advisory-scheduler tests in `apps/server/tests/integration/background-jobs.spec.ts`
- [x] T045 Implement PostgreSQL `SKIP LOCKED` leased job repository and advisory scheduler in `apps/server/src/modules/operations/background-jobs.ts`
- [x] T046 Rerun `pnpm db:verify` against fresh and accepted pre-0004 PostgreSQL 18 states, then replace stale content-safe foundation evidence in `ops/evidence/foundation/database.json` — REOPENED: verify 0001→0002→0003→0004 chain and replace stale evidence

**Checkpoint**: Real PostgreSQL enforces ownership and schema invariants before user-story repositories begin.

---

## Phase 4: User Story 1 — Start a Private Money Journal (P1)

**Goal**: Verified account access, supported Better Auth sessions, privacy onboarding, preferences, starter labels, and empty journal.

**Independent Test**: Signup → verify → login → session restore/revocation → onboarding/preferences → empty journal, with invalid-session and second-user denial.

- [x] T047 [P] [US1] Build isolated pinned-Better-Auth compatibility contract for verification, reset single use, supported DB `session.token`, restoration, `expiresIn=7d`, `updateAge=1h`, 30-day app revocation, and current/other/all revocation in `tests/providers/better-auth.compat.spec.ts` (FR-001–FR-003)
- [x] T048 [US1] After T032, T033, T042, T046, and T047 pass, execute all eight `pnpm test:auth:better-auth-compat` cases against real PostgreSQL, require zero Better Auth schema mismatch, verify email/reset at-rest/replay/expiry/cleanup and null OAuth fields, record schema/query snapshots without token values in `ops/evidence/provider/better-auth-compat.json`, and block T049–T063 on any unsupported behavior
- [x] T049 [P] [US1] Write auth, verification, reset, enumeration-safe error, cookie, session, and recent-auth HTTP contract tests in `apps/server/tests/contract/identity-api.contract.spec.ts` (FR-001–FR-003, FR-008)
- [x] T050 [US1] Configure Better Auth PostgreSQL adapter with dedicated identity pool (`cashmemo_identity`), Argon2id callbacks, supported core token semantics, disabled cookie cache/stateless/secondary storage, and secure host-only cookie in `apps/server/src/modules/identity/better-auth.adapter.ts` — REOPENED: adapter must use dedicated identity pool instead of cashmemo_runtime
- [x] T051 [US1] Implement signup, verification/resend, login, logout, one-hour single-use reset, and reset-driven revoke-all flows in `apps/server/src/modules/identity/identity.service.ts` (FR-001, FR-008, FR-009)
- [x] T052 [P] [US1] Implement project-owned email port, generic verification/reset templates, Mailpit adapter, and content-free delivery events in `apps/server/src/modules/identity/email.port.ts` and `apps/server/src/adapters/aws/ses-email.adapter.ts`
- [x] T053 [P] [US1] Write controlled-clock session inactivity/refresh/absolute-expiry, fixation, reset, revoke-current/others/all, and ReauthGrant tests in `apps/server/tests/integration/sessions.spec.ts` (FR-002, FR-003, FR-088)
- [x] T054 [US1] Implement protected-request session middleware, 30-day supported revocation, ten-minute one-time scoped ReauthGrant, and session-revocation use cases in `apps/server/src/modules/identity/session.service.ts` (FR-002, FR-003, FR-088)
- [x] T055 [P] [US1] Write onboarding, starter-label, default-currency override, stale-preference, timezone-warning, and retry tests in `apps/server/tests/integration/onboarding.spec.ts` (FR-004–FR-007, FR-009)
- [x] T056 [US1] Implement idempotent onboarding, privacy-notice acceptance, revisioned preferences, and exact starter-label seeding in `apps/server/src/modules/onboarding/onboarding.service.ts` (FR-004–FR-007, FR-051)
- [x] T057 [US1] Implement provider-neutral identity, onboarding, preferences, account, and session HTTP controllers from OpenAPI in `apps/server/src/modules/identity/identity.controller.ts` and `apps/server/src/modules/onboarding/onboarding.controller.ts`
- [x] T058 [P] [US1] Write browser tests for signup, verification, login/logout, restore, invalid session, onboarding privacy copy, and empty state in `apps/web/tests/component/us1-auth-onboarding.spec.tsx` — DEPENDS ON: T002 web scaffold
- [x] T059 [US1] Implement authentication, verification/reset, session-expired, and fail-closed protected-route UI in `apps/web/src/features/auth/AuthRoutes.tsx` — DEPENDS ON: T002 web scaffold
- [x] T060 [US1] Implement privacy onboarding, preferences with timezone warning, starter-label/empty journal presentation, and recoverable preference form state in `apps/web/src/features/onboarding/OnboardingFlow.tsx` (FR-004–FR-007) — DEPENDS ON: T002 web scaffold
- [x] T061 [US1] Execute account/session endpoint and RLS two-user denial matrix in `tests/security/us1-account-isolation.spec.ts` (FR-008, FR-010; SC-015)
- [x] T062 [US1] Create `pnpm acceptance:us1` Playwright suite covering all US1 scenarios, failure states, privacy copy, and shared isolation regressions in `tests/acceptance/us1-private-journal.spec.ts` — DEPENDS ON: T002 web scaffold, T058–T060
- [x] T063 [US1] Invoke `pnpm acceptance:us1` in HTTPS integration environment and write content-safe story evidence to `ops/evidence/stories/us1.json` (FR-118)

**Checkpoint**: US1 independently works. Failed T048 forbids undocumented auth workarounds.

---

## Phase 5: User Story 2 — Keep an Accurate Manual Money Journal (P1)

**Goal**: Exact structured manual capture, recoverable drafts, confirmed memo lifecycle, safe retries/conflicts, and second-user denial without STT/AI.

**Independent Test**: With providers disabled, create/retry/view/edit/archive/restore/delete/recover/initiate purge for one memo while second user receives no data.

- [ ] T064 [P] [US2] Write Money Memo API/domain contracts for positive amount, currency precision, occurrence tuple, optional fields, confirmation, and authoritative response in `apps/server/tests/contract/money-memo.contract.spec.ts` (FR-011–FR-020)
- [ ] T065 [P] [US2] Write same-device/server draft expiry, byte-equivalent text, revision-conflict, storage denial, account-switch, and cleanup tests in `apps/web/tests/integration/draft-recovery.spec.ts` (FR-041, FR-048, FR-111)
- [ ] T066 [P] [US2] Write duplicate/lost-response create, conflicting key, stale edit, lifecycle race, and second-user integration tests in `apps/server/tests/integration/manual-memo-concurrency.spec.ts` (FR-022–FR-030; SC-003, SC-004)
- [ ] T067 [P] [US2] Create failing `pnpm acceptance:us2` suite for all manual journal success/degraded/privacy scenarios in `tests/acceptance/us2-manual-journal.spec.ts`
- [ ] T068 [US2] Implement owned Money Memo repository and transactionally atomic create/edit plus IdempotencyRecord result in `apps/server/src/modules/memo/money-memo.service.ts` (FR-011–FR-029)
- [ ] T069 [US2] Implement manual confirm/get/update OpenAPI endpoints with strict schemas and privacy-safe conflicts in `apps/server/src/modules/memo/money-memo.controller.ts`
- [ ] T070 [US2] Implement owned first-page history query returning `resultSetVersion`, lifecycle predicates, and occurrence/ID order in `apps/server/src/modules/history/history.repository.ts` (FR-025, FR-026, FR-030)
- [ ] T071 [P] [US2] Implement account-scoped Dexie replica with no raw audio, seven-day expiry, logout/account-switch lock/clear, and pending idempotency identity in `apps/web/src/drafts/local-draft-store.ts` (FR-041, FR-111)
- [ ] T072 [US2] Implement revisioned server ComposeDraft create/update/list/discard and 24-hour cleanup scheduling in `apps/server/src/modules/draft/draft.service.ts` (FR-040–FR-042)
- [ ] T073 [US2] Implement explicit local/server conflict-preserving compose synchronization without offline authority in `apps/web/src/drafts/draft-sync.ts` (FR-041, FR-111)
- [ ] T074 [US2] Implement accessible manual Money Memo form with default/override currency and visible time ambiguity correction in `apps/web/src/features/memos/ManualMemoForm.tsx` (FR-006, FR-011–FR-020)
- [ ] T075 [US2] Implement memo detail/edit UI with current-revision reload and local conflicting-input preservation in `apps/web/src/features/memos/MoneyMemoEditor.tsx` (FR-023, FR-024)
- [ ] T076 [US2] Implement archive/active, Recently Deleted/prior-state restore, 30-day recovery, and deletion-race application services in `apps/server/src/modules/memo/memo-lifecycle.service.ts` (FR-022, FR-025–FR-028, FR-095)
- [ ] T077 [US2] Implement lifecycle and Recently Deleted HTTP endpoints with revision/state checks in `apps/server/src/modules/memo/memo-lifecycle.controller.ts`
- [ ] T078 [US2] Implement history, archive filter, Recently Deleted timing, restore, and destructive-confirmation UI in `apps/web/src/features/memos/MemoLifecycleViews.tsx` (FR-022, FR-025–FR-027, FR-095)
- [ ] T079 [US2] Implement recent-authenticated idempotent immediate-purge initiation that enters inaccessible `purging` without hard deleting before suppression recording in `apps/server/src/modules/deletion/memo-purge-request.service.ts` (FR-028, FR-088, FR-096)
- [ ] T080 [US2] Write draft-expiry, derived-metadata, Recently Deleted expiry/restore race, and purge-initiation lifecycle tests in `apps/server/tests/integration/manual-lifecycle-cleanup.spec.ts` (FR-028, FR-041, FR-042, FR-103)
- [ ] T081 [US2] Implement draft/derived-data/Recently Deleted due sweepers with idempotent inaccessible-first cleanup in `apps/server/src/modules/operations/journal-sweepers.ts`
- [ ] T082 [US2] Run manual-mode money/time/property, revision, idempotency, lifecycle, privacy-error, and two-account regression set and store safe results in `ops/evidence/stories/us2-regressions.json`
- [ ] T083 [US2] Invoke `pnpm acceptance:us2` with STT/AI disabled and write content-safe acceptance evidence to `ops/evidence/stories/us2.json` (FR-031, FR-118; SC-002–SC-005)

**Checkpoint**: Manual journal is independently usable; no later provider phase may become a dependency.

---

## Phase 6: History and Traversal Infrastructure

**Purpose**: Honest version-bound pagination for history, search, and recovery lists; no long-lived snapshots.

- [ ] T084 [P] Write property tests for unchanged `(occurred_at DESC, id DESC)` traversal, list-affecting mutations, query binding, and zero stale-page responses in `packages/domain/tests/versioned-traversal.property.spec.ts` (FR-030; SC-026)
- [ ] T085 Implement opaque authenticated cursor codec carrying version, last key, and no raw query/filter value in `apps/server/src/modules/history/cursor-codec.ts` (FR-030)
- [ ] T086 Implement deterministic canonical query/filter representation and HMAC fingerprint in `apps/server/src/modules/history/query-fingerprint.ts` (FR-030)
- [ ] T087 Implement account-scoped monotonic HistoryListState repository with short read-consistent transaction semantics in `apps/server/src/modules/history/history-list-state.repository.ts` (FR-030)
- [ ] T088 Implement continuation keyset query that rechecks ownership/lifecycle and returns no page on version/query mismatch in `apps/server/src/modules/history/versioned-traversal.service.ts` (FR-030)
- [ ] T089 Wire transactional version increments into create, occurrence/filterable-field edit, archive, restore, delete, purge, and recovery-list mutations in `apps/server/src/modules/memo/history-invalidation.ts` (FR-030)
- [ ] T090 Expose stable HTTP 409 `RESULTS_CHANGED` with `restartRequired=true` and no partial continuation body in `apps/server/src/modules/history/history.controller.ts` (FR-030)
- [ ] T091 Implement refresh-required UX that discards obsolete cursors without replaying inaccessible data in `apps/web/src/features/history/ResultsChangedBoundary.tsx` (FR-030)
- [ ] T092 Run multi-transaction create/edit/archive/restore/delete/purge races, cursor tampering, query mismatch, and cross-user continuation tests in `apps/server/tests/integration/versioned-traversal.spec.ts` (FR-030; SC-026)
- [ ] T093 Execute traversal concurrency suite against deployed PostgreSQL and store SC-026 evidence in `ops/evidence/success-criteria/sc026-versioned-traversal.json`

**Checkpoint**: Every changed traversal refreshes visibly; unchanged traversal is stable; purged/inaccessible rows never replay.

---

## Phase 7: User Story 6 — Organize and Find Money Activity (P2)

**Goal**: Revisioned categories/Money Spaces, private search, intersection filters, and label-driven traversal invalidation.

**Independent Test**: Manage starter/custom labels and find exact account-owned subsets across every filter, lifecycle, search, empty, and stale-traversal case.

- [ ] T094 [P] [US6] Write category/Money Space lifecycle, normalized uniqueness, kind/reference, stale revision, and no-account-semantics contracts in `apps/server/tests/contract/labels.contract.spec.ts` (FR-051–FR-055)
- [ ] T095 [P] [US6] Write search/vector, date/direction/label/purpose/planning/currency/lifecycle intersection, ordering, and empty-state tests in `apps/server/tests/integration/search-filters.spec.ts` (FR-056–FR-059)
- [ ] T096 [P] [US6] Write detector-before-label/search, URL/log exclusion, Unicode/control-input, and no-cross-user-value tests in `apps/server/tests/privacy/search-label-boundaries.spec.ts` (FR-056, FR-060, FR-075, FR-078)
- [ ] T097 [US6] Implement owned Category/MoneySpace create/rename/deactivate/restore services with normalized active uniqueness and reference safety in `apps/server/src/modules/labels/labels.service.ts` (FR-051–FR-055)
- [ ] T098 [US6] Implement category and Money Space OpenAPI endpoints with revision/idempotency/privacy checks in `apps/server/src/modules/labels/labels.controller.ts`
- [ ] T099 [US6] Add generated `simple` text-search projection, GIN index, and transactional label-name refresh migration in `apps/server/src/adapters/postgres/migrations/0005_search_projection.sql` (FR-056)
- [ ] T100 [US6] Implement account-first search and intersection-filter repository with bound transient query values in `apps/server/src/modules/history/search.repository.ts` (FR-056–FR-060)
- [ ] T101 [US6] Increment HistoryListState transactionally for label rename/status changes affecting search/filter membership in `apps/server/src/modules/labels/history-invalidation.ts` (FR-030, FR-052, SC-026)
- [ ] T102 [P] [US6] Implement label management UI that presents Money Spaces only as context labels and preserves failed edits in `apps/web/src/features/labels/LabelManager.tsx` (FR-052–FR-055)
- [ ] T103 [US6] Implement POST search/filter UI with visible removable criteria, stable pages, loading/error/no-match/reset, and `RESULTS_CHANGED` refresh in `apps/web/src/features/history/SearchAndFilters.tsx` (FR-056–FR-059)
- [ ] T104 [US6] Execute label/search/filter endpoint, RLS, GIN, and cursor two-account isolation matrix in `tests/security/us6-search-label-isolation.spec.ts` (FR-060, FR-082; SC-015)
- [ ] T105 [US6] Create `pnpm acceptance:us6` suite covering every US6 success/degraded/privacy scenario and shared traversal regressions in `tests/acceptance/us6-organize-find.spec.ts`
- [ ] T106 [US6] Invoke `pnpm acceptance:us6` and write content-safe evidence to `ops/evidence/stories/us6.json` (FR-118)

**Checkpoint**: Growing journal can be organized/found without label-account semantics or search disclosure.

---

## Phase 8: User Story 4 — Understand Current Month (P1)

**Goal**: Compact deterministic current-month overview, exact per-currency totals/buckets, recent active memos, and honest empty/failure states.

**Independent Test**: Golden multi-currency/timezone dataset reproduces every total and bucket without monthly review or AI.

- [ ] T107 [P] [US4] Write income/expense/net, currency partition, archived/deleted/draft eligibility, bucket completion, and DST-boundary property tests in `packages/domain/tests/current-month-overview.property.spec.ts` (FR-061–FR-065; SC-005, SC-006, SC-012)
- [ ] T108 [P] [US4] Create independent PostgreSQL/export-recomputed current-month golden fixtures in `apps/server/tests/fixtures/reporting/current-month-golden.ts` and tests in `apps/server/tests/integration/current-month-overview.spec.ts` (FR-072)
- [ ] T109 [US4] Implement exact currency-first aggregation, net, category/planning/purpose buckets, eligibility, and deterministic ordering in `packages/domain/src/reporting/current-month.ts` (FR-061–FR-065)
- [ ] T110 [US4] Implement account-owned reporting-zone query/service with archived inclusion and deleted/draft exclusion in `apps/server/src/modules/reporting/current-month.service.ts` (FR-061–FR-065)
- [ ] T111 [US4] Implement `/overview/current-month` controller with no stale/partial-success response in `apps/server/src/modules/reporting/current-month.controller.ts` (FR-071)
- [ ] T112 [US4] Implement responsive per-currency overview, recent active memos, breakdowns, and zero/empty states in `apps/web/src/features/reporting/CurrentMonthOverview.tsx` (FR-063–FR-065)
- [ ] T113 [US4] Test protected-cache/telemetry exclusion and named calculation-unavailable behavior while capture/history remain usable in `apps/server/tests/privacy/current-month-privacy.spec.ts` (FR-071, FR-078)
- [ ] T114 [US4] Create `pnpm acceptance:us4` suite covering all US4 scenarios, calculation failure, timezone, empty, and privacy cases in `tests/acceptance/us4-current-month.spec.ts`
- [ ] T115 [US4] Invoke `pnpm acceptance:us4` and write content-safe golden evidence to `ops/evidence/stories/us4.json` (FR-118)

**Checkpoint**: Current-month value is exact, deterministic, protected, and never cross-currency.

---

## Phase 9: User Story 7 — Review a Month Deterministically (P2)

**Goal**: Selected/prior-month review with exact rankings, zero-baseline behavior, timezone boundaries, and separate currencies.

**Independent Test**: Two adjacent multi-currency months reproduce totals/rankings/comparisons from export fixtures, including ties and prior zero.

- [ ] T116 [P] [US7] Write selected/prior-month, ranking-tie, prior-zero, negative-net, empty-currency, and currency-partition property tests in `packages/domain/tests/monthly-review.property.spec.ts` (FR-066–FR-070; SC-012)
- [ ] T117 [P] [US7] Create independent two-month PostgreSQL/export golden fixtures and integration oracle in `apps/server/tests/fixtures/reporting/monthly-review-golden.ts` and `apps/server/tests/integration/monthly-review.spec.ts` (FR-072)
- [ ] T118 [US7] Implement deterministic expense ranking, unplanned totals, absolute/percentage comparison, and currency-section eligibility in `packages/domain/src/reporting/monthly-review.ts` (FR-066–FR-070)
- [ ] T119 [US7] Implement reporting-zone selected/prior-month query/service with confirmed-only eligibility in `apps/server/src/modules/reporting/monthly-review.service.ts` (FR-066–FR-071)
- [ ] T120 [US7] Implement `/reviews/monthly/{month}` controller with strict period and unavailable-result handling in `apps/server/src/modules/reporting/monthly-review.controller.ts`
- [ ] T121 [US7] Implement responsive per-currency monthly review, deterministic ranking, no-percentage explanation, and empty states in `apps/web/src/features/reporting/MonthlyReview.tsx`
- [ ] T122 [US7] Add API/UI/export static/property scan proving no AI narrative, exchange-rate, base-currency, or cross-currency scalar path in `tests/security/monthly-review-scope.spec.ts` (FR-017, FR-070; SC-006)
- [ ] T123 [US7] Create `pnpm acceptance:us7` suite covering all US7 success/degraded/privacy scenarios in `tests/acceptance/us7-monthly-review.spec.ts`
- [ ] T124 [US7] Invoke `pnpm acceptance:us7` and write content-safe golden evidence to `ops/evidence/stories/us7.json` (FR-118)

**Checkpoint**: Monthly financial results remain deterministic and user-confirmed-record-only.

---

## Phase 10: User Story 3 — Turn Words or Voice into a Reviewed Draft (P1)

**Goal**: Typed/voice capture through finite privacy controls, temporary audio, replaceable STT/AI adapters, visible uncertainty, and explicit confirmation.

**Independent Test**: Typed and 60-second-capable voice inputs create editable drafts only; invalid/ambiguous results fail safely; four audio deletion paths prove absence; confirmation creates exactly one user-edited memo.

- [ ] T125 [P] [US3] Create versioned multilingual synthetic detector corpus and rule-family precision/recall/adversarial tests in `packages/privacy-rules/tests/detector-v1.spec.ts` and `packages/privacy-rules/fixtures/corpus-v1.json` (FR-075, FR-076)
- [ ] T126 [US3] Implement v1 ephemeral normalization and finite PAN/IBAN/secret/account/identity detector families without candidate/span persistence in `packages/privacy-rules/src/detector-v1.ts` (FR-075–FR-077)
- [ ] T127 [P] [US3] Write provider-port contract tests for STT, extraction, validation, bounded retry, safe errors, consent, and provider-type isolation in `apps/server/tests/contract/assisted-provider-ports.contract.spec.ts` (FR-036, FR-049, FR-050, FR-080, FR-086)
- [ ] T128 [US3] Define project-owned `SttPort`, `ExtractionPort`, provider-neutral result states, strict schemas, and deadlines in `apps/server/src/modules/assisted-capture/provider-ports.ts`
- [ ] T129 [US3] Implement deterministic strict STT/extraction fakes and replacement toggles against those contracts in `apps/server/src/adapters/fakes/assisted-provider.adapters.ts`
- [ ] T130 [P] [US3] Write typed-text extraction tests for relative anchor, byte-equivalent recovery, detector block, consent, ambiguity, invalid output, and no auto-confirm in `apps/server/tests/integration/text-extraction.spec.ts` (FR-019, FR-032, FR-034–FR-036, FR-048, FR-050)
- [ ] T131 [US3] Implement typed natural-language extraction use case that persists only checked project-owned draft state in `apps/server/src/modules/assisted-capture/text-extraction.service.ts` (FR-032, FR-034–FR-037)
- [ ] T132 [US3] Implement typed capture UI with adjacent prohibited-data guidance, explicit provider consent, editable uncertainty, and live-memory correction on block in `apps/web/src/features/capture/NaturalLanguageCapture.tsx` (FR-034, FR-050, FR-074)
- [ ] T133 [P] [US3] Write MIME/magic/codec/size/measured-duration, permission, 60-second auto-stop, interruption, and spoofing tests in `apps/server/tests/integration/audio-admission.spec.ts` and `apps/web/tests/component/voice-recorder.spec.tsx` (FR-043, FR-046)
- [ ] T134 [US3] Implement request-owned bounded-memory/encrypted-ephemeral audio lifecycle with content-free metadata and `try/finally` deletion in `apps/server/src/modules/assisted-capture/temporary-audio.service.ts` (FR-038, FR-044, FR-045)
- [ ] T135 [US3] Implement one-minute expiry sweeper, startup directory cleanup, refusal-after-expiry, deletion retry/alert, and task-termination hook in `apps/server/src/modules/operations/audio-sweeper.ts` (FR-044, FR-045)
- [ ] T136 [P] [US3] Write voice state-machine, lost-upload-response, incomplete transcript, STT/AI failure, and never-confirm-partial integration tests in `apps/server/tests/integration/voice-capture.spec.ts` (FR-033, FR-037, FR-038, FR-046)
- [ ] T137 [US3] Implement voice capture start/upload/status/cancel orchestration and provider-neutral OpenAPI endpoints in `apps/server/src/modules/assisted-capture/voice-capture.service.ts` and `apps/server/src/modules/assisted-capture/voice-capture.controller.ts` (FR-033, FR-043–FR-046)
- [ ] T138 [US3] Implement browser MediaRecorder flow with explicit start, provider notice, elapsed/remaining timer, 60-second hard stop, permission/interruption states, and no durable audio in `apps/web/src/features/capture/VoiceRecorder.tsx` (FR-043, FR-046, FR-050, FR-074)
- [ ] T139 [US3] Run transcript detector before persistence/AI, label incomplete text, and persist allowed transcript only in recoverable draft in `apps/server/src/modules/assisted-capture/transcript.service.ts` (FR-037, FR-046, FR-075)
- [ ] T140 [US3] Implement strict extraction-output validation for money/time/ownership/labels/extra fields/future values and correction states in `apps/server/src/modules/assisted-capture/extraction-validation.ts` (FR-034–FR-036, FR-080)
- [ ] T141 [US3] Implement transcript and structured-draft review UI with editable every field and explicit inferred/uncertain/missing/contradictory states in `apps/web/src/features/capture/AssistedDraftReview.tsx` (FR-034)
- [ ] T142 [US3] Enforce operation-specific STT/text/transcript-to-AI consent and disclose raw-voice-before-text-detection limitation in `apps/server/src/modules/assisted-capture/consent-policy.ts` and `apps/web/src/features/privacy/ProviderConsent.tsx` (FR-050)
- [ ] T143 [P] [US3] Write repeated-confirmation, changed-fields-authority, stale-draft, and confirmed-memo-nonmutation tests in `apps/server/tests/integration/assisted-confirmation.spec.ts` (FR-039, FR-047)
- [ ] T144 [US3] Implement separate idempotent explicit assisted-draft confirmation transaction that revalidates user-edited fields and schedules draft/derived cleanup in `apps/server/src/modules/assisted-capture/confirm-draft.service.ts` (FR-032, FR-039, FR-042, FR-047)
- [ ] T145 [US3] Map timeout/rate-limit/refusal/invalid-schema/partial-provider states to content-free visible degradation without altering confirmed records in `apps/server/src/modules/assisted-capture/provider-failure-policy.ts` (FR-036–FR-039, FR-049)
- [ ] T146 [P] [US3] Implement protected real-OpenAI STT adapter contract harness for pinned model/formats/errors with SDK logging disabled in `tests/providers/openai-stt.contract.spec.ts`
- [ ] T147 [P] [US3] Implement protected real-OpenAI extraction adapter contract harness for pinned snapshot, `store:false`, strict schema, no tools/files/background, and invalid/ambiguous cases in `tests/providers/openai-extraction.contract.spec.ts`
- [ ] T148 [US3] Prove success/cancel/unrecoverable-failure/one-hour-expiry/task-kill audio deletion with direct absence probes in `tests/operations/audio-lifecycle.spec.ts` (FR-044, FR-045, FR-103; SC-009)
- [ ] T149 [US3] Implement outbound provider capture proxy that records field names/length classes only and verifies current-capture minimization in `packages/test-support/src/providers/payload-capture-proxy.ts` (FR-078, FR-086)
- [ ] T150 [US3] Create `pnpm acceptance:us3` suite for every typed/voice success, ambiguity, invalid, interruption, privacy, deletion, edit, and confirmation scenario in `tests/acceptance/us3-assisted-capture.spec.ts`
- [ ] T151 [US3] Invoke `pnpm acceptance:us3` with contract fakes and store clearly non-real-provider story evidence in `ops/evidence/stories/us3-integration.json`; keep real-provider closure open (FR-105, FR-118)

**Checkpoint**: Assisted capture works as draft accelerator only; manual journal remains independent; real-provider launch evidence remains open.

---

## Phase 11: User Story 5 — Continue Safely Through Failures (P1)

**Goal**: Explicit degradation, safe retries, recoverable unconfirmed work, and unchanged confirmed records through provider/network/telemetry/core failures.

**Independent Test**: Disable/fault every accelerator and interrupt request/response/commit points; manual operation remains safe where core services exist and never becomes local authority when core services fail.

- [ ] T152 [P] [US5] Define executable failure matrix for STT, AI, network, DB, auth, SES, S3, KMS, telemetry, worker, and calculation fault points in `tests/failure/failure-matrix.ts` (FR-031, FR-111)
- [ ] T153 [US5] Implement deterministic timeout/reset/lost-response/rate-limit/invalid-body/connection-kill scenarios in `packages/test-support/src/harness/fault-proxy-scenarios.ts`
- [ ] T154 [P] [US5] Write browser offline-before-save, upload interruption, lost-confirm-response, app-close/reopen, and update-with-draft tests in `apps/web/tests/integration/network-recovery.spec.ts` (FR-041, FR-046, FR-111; SC-011)
- [ ] T155 [P] [US5] Write DB before/after-commit response-loss and duplicate-job tests proving one authoritative result in `apps/server/tests/integration/commit-point-retry.spec.ts` (FR-029, FR-047, FR-111; SC-003)
- [ ] T156 [US5] Make `dev:manual` and production provider-disabled startup first-class with no STT/AI/telemetry dependency in `apps/server/src/bootstrap/capability-mode.ts` (FR-031; SC-010)
- [ ] T157 [US5] Implement explicit capability-health states and safe user messages in `apps/web/src/features/degraded/CapabilityStatus.tsx` (FR-049)
- [ ] T158 [US5] Implement non-blocking bounded/drop-safe telemetry exporter with content-free health counters and no user-payload fallback queue in `apps/server/src/adapters/telemetry/resilient-exporter.ts`
- [ ] T159 [US5] Enforce explicit fail-closed auth/persistence outage responses and forbid authoritative local writes in `apps/server/src/bootstrap/core-readiness.guard.ts`
- [ ] T160 [US5] Implement partial STT/AI failure recovery and declared transcript/draft retention without partial confirmation in `apps/server/src/modules/assisted-capture/recovery-policy.ts` (FR-037, FR-038, FR-046)
- [ ] T161 [US5] Run failure-injection assertions that confirmed rows/revisions/totals remain unchanged and every partial state is visible in `tests/failure/confirmed-record-invariants.spec.ts`
- [ ] T162 [US5] Create `pnpm acceptance:us5` suite covering every US5 fault, manual-mode, privacy, retry, and draft-recovery scenario in `tests/acceptance/us5-degraded-operation.spec.ts`
- [ ] T163 [US5] Invoke `pnpm acceptance:us5` with provider/telemetry/network fault injection and write evidence to `ops/evidence/stories/us5.json` (FR-118; SC-010, SC-011)

**Checkpoint**: Accelerator failures never block manual journal or mutate confirmed truth; core outage never creates unsafe local authority.

---

## Phase 12: User Story 8 — Export and Permanently Delete My Data (P2)

**Goal**: Deterministic export, secure expiring delivery, record/account deletion lifecycle, provider tracking, and suppression-gated purge orchestration.

**Independent Test**: Export/verify/cancel; recover/purge records; request/cancel/complete account deletion through contract-backed suppression port with explicit pending/failure states.

- [ ] T164 [P] [US8] Write export v1 JSON/CSV/manifest ordering, checksum, formula-injection, schema-version, snapshot, draft-label, and no-conversion golden tests in `apps/server/tests/contract/export-v1.contract.spec.ts` (FR-091–FR-094; SC-019)
- [ ] T165 [US8] Implement deterministic export v1 serializers and independent aggregate reproduction rules in `apps/server/src/modules/export/export-v1.serializer.ts` (FR-091, FR-092, FR-072)
- [ ] T166 [US8] Implement idempotent leased export snapshot/build/state worker with integrity verification in `apps/server/src/modules/export/export-job.service.ts` (FR-093)
- [ ] T167 [P] [US8] Implement project-owned object storage adapter for private KMS export objects, opaque keys, same-origin streams, version deletion, and contract fake in `apps/server/src/adapters/aws/export-object-store.adapter.ts` (FR-094)
- [ ] T168 [US8] Implement export request/list/status/download/cancel endpoints with recent auth, ownership, five-minute delivery, and 24-hour expiry in `apps/server/src/modules/export/export.controller.ts` (FR-093, FR-094)
- [ ] T169 [US8] Implement export request/progress/download/cancel UI with schema/draft disclosures and no raw object URL in `apps/web/src/features/export/ExportCenter.tsx` (FR-091–FR-094)
- [ ] T170 [US8] Test controlled-clock cancel/expiry/inaccessibility and every S3 object version deletion within 24 hours in `tests/operations/export-lifecycle.spec.ts` (FR-094, FR-103; SC-020)
- [ ] T171 [P] [US8] Write account grace/cancel/irreversibility, export/session race, idempotency, live/provider-completion, and failed-purge state tests in `apps/server/tests/integration/account-deletion.spec.ts` (FR-097–FR-102)
- [ ] T172 [US8] Implement seven-day account deletion grace, suspended journal access, cancellation, irreversible transition, and incomplete-stage semantics in `apps/server/src/modules/deletion/account-deletion.service.ts` (FR-097–FR-102)
- [ ] T173 [US8] Implement account-deletion request/status/cancel OpenAPI endpoints with reauthentication and destructive confirmation in `apps/server/src/modules/deletion/account-deletion.controller.ts` (FR-088, FR-097)
- [ ] T174 [US8] Implement deletion grace/provider/backup disclosure and cancellation UI without misleading completion in `apps/web/src/features/deletion/AccountDeletionFlow.tsx` (FR-097, FR-101, FR-102)
- [ ] T175 [P] [US8] Write exact HMAC-SHA-256 entity-type/canonical-UUID token, no-raw-identity ledger shape, write-failure, and idempotency tests in `apps/server/tests/contract/deletion-suppression-port.contract.spec.ts` (FR-096, FR-100)
- [ ] T176 [US8] Define project-owned deletion-suppression port, token derivation, key-version contract, and deterministic fake with no TTL removal API in `apps/server/src/modules/deletion/deletion-suppression.port.ts` (FR-100)
- [ ] T177 [US8] Implement memo purge worker that verifies durable `money_memo` suppression record before deleting content/search/draft/provider state in `apps/server/src/modules/deletion/memo-purge.worker.ts` (FR-028, FR-096, FR-099, FR-100)
- [ ] T178 [US8] Implement account purge worker that verifies durable `account` suppression record before deleting every live data class/session/export/identity in `apps/server/src/modules/deletion/account-purge.worker.ts` (FR-098–FR-102)
- [ ] T179 [US8] Implement provider deletion/not-required/pending-escalation tracking without claiming live failure complete in `apps/server/src/modules/deletion/provider-deletion.service.ts` (FR-098, FR-102)
- [ ] T180 [US8] Execute two-account export/object/purge/recovery/account-deletion authorization and irreversible-state matrix in `tests/security/us8-data-ownership-isolation.spec.ts` (FR-082; SC-015)
- [ ] T181 [US8] Implement Recently Deleted, immediate purge, account grace, provider-pending, backup-aging, and legal-record limitation copy in `apps/web/src/features/deletion/DeletionDisclosures.tsx` (FR-095, FR-101)
- [ ] T182 [US8] Test deleted financial content absence across purge logs, evidence, errors, and support adapters in `apps/server/tests/privacy/deletion-evidence.spec.ts` (FR-104)
- [ ] T183 [US8] Create `pnpm acceptance:us8` suite covering export, record recovery/purge, account grace/cancel/purge, pending/failure, privacy, and retry scenarios in `tests/acceptance/us8-data-ownership.spec.ts`
- [ ] T184 [US8] Invoke `pnpm acceptance:us8` against contract-backed storage/suppression adapters and write integration evidence to `ops/evidence/stories/us8-integration.json`; keep real restore/provider closure open (FR-105, FR-118)

**Checkpoint**: Product lifecycle works against verified ports; irreversible production deletion still depends on Phase 13 and real Phase 17 evidence.

---

## Phase 13: Backup and Deletion Reconciliation

**Purpose**: Exact memo/account suppression, verified cleanup floor, prohibited-copy policy, restore-before-release tooling, and operational drill harness.

- [ ] T185 [P] Write AWS deletion-ledger contract tests for durable conditional writes, encryption, no raw identity/content, no lifecycle TTL, and privileged removal in `tests/providers/aws-deletion-ledger.contract.spec.ts` (FR-100)
- [ ] T186 Implement KMS-encrypted S3 deletion-suppression adapter with content-free keys/body/version checks in `apps/server/src/adapters/aws/deletion-suppression.adapter.ts` (FR-100)
- [ ] T187 Verify both memo/account purge workers never hard-delete before ledger durability and retain inaccessible retry state on ledger failure in `apps/server/tests/integration/write-before-purge.spec.ts` (FR-096, FR-098, FR-100; SC-020)
- [ ] T188 Implement suppression HMAC key-version creation/rotation/retention with no retirement while records remain in `apps/server/src/modules/deletion/suppression-key-manager.ts` (FR-100)
- [ ] T189 [P] Write full-lineage inventory contract tests for automated windows, retained backups, manual/final/copied/shared snapshots, AWS Backup, replication, and restore copies in `tests/providers/aws-backup-inventory.contract.spec.ts` (FR-100)
- [ ] T190 Implement authoritative RDS/AWS Backup/snapshot/replica/restore-copy inventory adapter with unavailable/stale result states in `apps/server/src/adapters/aws/backup-lineage-inventory.adapter.ts` (FR-100)
- [ ] T191 [P] Write `removal_not_before_at`, capable/unverifiable artifact, alert/retry, key-retention, and no-time-only-success tests in `tests/operations/suppression-cleanup.spec.ts` (FR-100; SC-021)
- [ ] T192 Implement verifier-controlled suppression cleanup that retains/alerts/retries on every failed or unavailable proof in `apps/server/src/modules/deletion/suppression-cleanup.service.ts` (FR-100)
- [ ] T193 Add policy-as-code denying untracked manual/final/copied/shared snapshots, retained automated backups, AWS Backup recovery points, and cross-region replication in `infra/opentofu/modules/data-safety/no-resurrection-copies.tf` (FR-100)
- [ ] T194 [P] Write isolated restore tests for account-first then memo-token matching across key versions, expired sweepers, session revocation, neighboring-data survival, and release denial in `tests/operations/restore-reconciliation.spec.ts` (FR-028, FR-100, FR-115; SC-021)
- [ ] T195 Implement isolated pre-network restore reconciliation command with exact account/memo suppression and mandatory verification checklist in `scripts/operations/restore-reconcile.mjs` (FR-100, FR-115)
- [ ] T196 Implement tagged restore-copy registration, lineage inventory, network-isolation guard, and verified destruction command in `scripts/operations/restore-copy-lifecycle.mjs` (FR-100)
- [ ] T197 Create production-safe PITR restore/release runbook with owners, approvals, RPO/RTO, and content-safe evidence in `ops/runbooks/backup-restore.md` (FR-114, FR-115)
- [ ] T198 Create suppression cleanup/key rotation/policy-drift runbook with blocker retention and escalation in `ops/runbooks/deletion-suppression-cleanup.md` (FR-100)
- [ ] T199 Build `pnpm test:operations` backup/restore/purge/cleanup orchestration using synthetic identities only in `tests/operations/operations-suite.ts` (FR-103, FR-114, FR-115)
- [ ] T200 Define quarterly isolated restore and cleanup drill automation, evidence schema, and pass/fail checks in `ops/drills/quarterly-restore.ts` and `ops/drills/suppression-cleanup.ts` (FR-114, FR-115; SC-021)
- [ ] T201 Validate Phase 13 harness locally/contractually and store non-production readiness evidence—not SC-021 closure—in `ops/evidence/operations/deletion-restore-readiness.json`

**Checkpoint**: Deletion/restore machinery is ready for real infrastructure; SC-021 remains open until T268.

---

## Phase 14: Privacy and Security Hardening

**Purpose**: Structural Constitution 2.0.0 enforcement across every boundary and complete security/isolation matrix.

- [ ] T202 [P] Enumerate and test device draft, server draft, typed provider, transcript persistence/AI, note, label, search, support, and evidence boundary matrix in `tests/privacy/boundary-matrix.spec.ts` (FR-074–FR-077)
- [ ] T203 Implement browser/server boundary adapters so detector matches block before each covered persistence/query/provider operation in `apps/server/src/modules/privacy/privacy-boundary.service.ts` and `apps/web/src/privacy/privacy-boundary.ts` (FR-075)
- [ ] T204 Implement allowlist-only logger/metric/trace/client-diagnostic APIs with fixed enums and no general serializer in `apps/server/src/adapters/telemetry/safe-telemetry.ts` and `apps/web/src/privacy/safe-client-diagnostics.ts` (FR-078, FR-079)
- [ ] T205 [P] Build seeded privacy-canary scanner for logs, traces, metrics, errors, URLs, evidence, job rows, client reports, and provider captures in `packages/test-support/src/privacy/canary-scanner.ts` (FR-078, FR-104; SC-016)
- [ ] T206 Run success/failure/retry/invalid/export/deletion/crash canaries through every declared diagnostic channel in `tests/privacy/diagnostic-channels.spec.ts` (FR-078, FR-079; SC-016)
- [ ] T207 [P] Add static OpenAPI/DB/UI/email/copy scan proving zero dedicated prohibited fields/solicitation and adjacent guidance in `tests/privacy/interface-surface.spec.ts` (FR-073, FR-074; SC-017)
- [ ] T208 Publish versioned detector precision/recall, languages, false-positive/false-negative limits, and forbidden completeness claims in `docs/privacy/detector-v1-limitations.md` (FR-076, FR-077; SC-017)
- [ ] T209 Test and document explicit raw-voice-to-approved-STT-before-text-detection limitation and minimization in `tests/privacy/voice-boundary.spec.ts` and `docs/privacy/voice-processing.md` (FR-076, FR-086)
- [ ] T210 Create prohibited-persisted-content incident procedure with containment, user correction/deletion, provider review, evidence protection, and governance approval in `ops/runbooks/privacy-incident.md` (FR-090)
- [ ] T211 [P] Execute full endpoint/RLS/FK/S3/audio/deletion IDOR matrix, missing/forged context, pool reset, and maintenance-role separation in `tests/security/cross-user-isolation.spec.ts` (FR-010, FR-060, FR-081, FR-082; SC-015)
- [ ] T212 [P] Test session fixation/rotation/revocation, CSRF/origin, cookie flags, reset/verification replay, enumeration timing/shape, and token telemetry exclusion in `tests/security/authentication.spec.ts` (FR-001–FR-003, FR-008)
- [ ] T213 Implement and test account/global rate/spend controls for auth, capture, extraction, search, export, and deletion without cross-user leakage in `apps/server/src/modules/operations/abuse-controls.ts` (FR-087)
- [ ] T214 [P] Test malicious schemas/provider output, oversized text/audio, MIME spoofing, SQL/search metacharacters, ZIP/CSV injection, and Unicode controls in `tests/security/untrusted-inputs.spec.ts` (FR-080)
- [ ] T215 Implement and verify CSRF/origin enforcement, CSP, HSTS, frame/referrer/content-type headers, and secure download policy in `apps/server/src/adapters/http/security-boundary.ts`
- [ ] T216 Integrate dependency/image/IaC/SBOM/license/secret scans as blocking security gates in `.github/workflows/security.yml` (FR-083, FR-116)
- [ ] T217 Run privacy suite and write only scanned aggregate evidence to `ops/evidence/privacy/privacy-gate.json` (FR-073–FR-086; SC-016, SC-017)
- [ ] T218 Run security/isolation suite and write content-safe evidence to `ops/evidence/security/security-gate.json` (SC-015)

**Checkpoint**: Constitution privacy boundary is structural and tested; no semantic-completeness claim exists.

---

## Phase 15: Production Infrastructure and Operations

**Purpose**: Repeatable AWS staging/production topology, deployment, secrets, monitoring, backups, external-input binding, and runbooks.

- [ ] T219 [P] Define OpenTofu version/provider constraints, remote-state contract, validated environment inputs, and plan-digest policy in `infra/opentofu/versions.tf`, `infra/opentofu/backend.tf`, and `infra/opentofu/variables.tf`
- [ ] T220 [P] Provision VPC, private/public subnets, security groups, ALB, TLS listener, and controlled egress modules in `infra/opentofu/modules/network/main.tf`
- [ ] T221 [P] Provision ECR and one ECS/Fargate service/image supporting API/worker roles, encrypted ephemeral storage, health checks, and deployment circuit breaker in `infra/opentofu/modules/compute/main.tf`
- [ ] T222 [P] Provision PostgreSQL 18 RDS Multi-AZ, encryption, nonpublic networking, parameter/monitoring groups, 35-day backup/PITR maximum, and deletion protection in `infra/opentofu/modules/database/main.tf` (FR-100, FR-114)
- [ ] T223 [P] Provision separate KMS-encrypted export, evidence, and deletion-ledger buckets/policies with no raw-audio class and no suppression TTL in `infra/opentofu/modules/storage/main.tf` (FR-094, FR-100)
- [ ] T224 [P] Provision SES identity/configuration-set/bounce path with content-free event mapping in `infra/opentofu/modules/email/main.tf`
- [ ] T225 [P] Provision Secrets Manager/KMS and least-privilege runtime, worker, migration, restore, CI, and break-glass roles in `infra/opentofu/modules/security/main.tf` (FR-083)
- [ ] T226 [P] Provision OpenTelemetry collector, CloudWatch log/metric/trace retention, core/provider-separated dashboards, burn-rate/backlog/audio/deletion/export/backup alarms in `infra/opentofu/modules/observability/main.tf` (FR-110, FR-112)
- [ ] T227 Integrate database backup/PITR, policy-drift, inventory-failure, missed-drill, and RPO/RTO alarms with deletion-copy policy in `infra/opentofu/modules/data-safety/main.tf` (FR-100, FR-114)
- [ ] T228 Implement one-shot migration task, advisory lock, schema compatibility startup check, and migration evidence in `infra/opentofu/modules/compute/migration-task.tf` and `scripts/db/migrate-production.mjs` (FR-116)
- [ ] T229 Harden OCI image with pinned digest inputs, minimal packages/capabilities, non-root/read-only runtime, health probes, and SBOM attachment in `infra/containers/Dockerfile` and `infra/containers/docker-bake.hcl` (FR-116)
- [ ] T230 Implement GitHub Actions build/scan/migrate/deploy/synthetic-verify workflow using immutable digest and protected environments in `.github/workflows/deploy.yml` (FR-116, FR-117)
- [ ] T231 Implement and rehearse ECS circuit-breaker rollback plus expand/contract safe-forward paths in `scripts/deploy/rollback-or-safe-forward.mjs` and `ops/runbooks/deployment-rollback.md` (FR-116)
- [ ] T232 Bootstrap production-equivalent staging from empty prerequisites, run drift checks, and record environment metadata in `infra/opentofu/environments/staging/main.tf` and `ops/evidence/infrastructure/staging-bootstrap.json` (FR-105)
- [ ] T233 Bind—not fabricate—approved AWS account IDs, `ap-southeast-1`, DNS/TLS names, environment IDs, and protected workflow identities in `infra/opentofu/environments/production/inputs.auto.tfvars.example` and `ops/evidence/external/aws-environment.json`; fail closed while missing
- [ ] T234 Bind exact dependency patch versions, security review dates, model snapshots, currency registry, and tzdb versions in `config/release/dependency-baseline.json` and `ops/evidence/external/dependency-review.json`; block unresolved/expired entries
- [ ] T235 Create versioned provider-decision schema/template covering data sent/excluded, training, retention/deletion, residency, failures, replacement, DPA owner, and evidence expiry in `config/providers/provider-decision.schema.json` and `docs/providers/decision-template.md` (FR-084)
- [ ] T236 Obtain and verify—not fabricate—OpenAI production project ZDR, training-disabled, endpoint/model eligibility, regional limitation, and administrative evidence in protected reference `ops/evidence/external/openai-zdr-approval.json`; keep launch blocked if absent (FR-085)
- [ ] T237 Obtain and verify—not fabricate—SES production/domain authorization and controlled-inbox readiness in protected reference `ops/evidence/external/ses-production-approval.json`; keep signup release blocked if absent
- [ ] T238 Assign named accountable humans/teams for release, privacy, security, SRE, data operations, providers, accessibility, and research in `ops/owners.yaml`; reject role-only placeholders before release (FR-119)
- [ ] T239 Validate and approve normal-load concurrency/account-size profile against beta or controlled measurements in `tests/performance/normal-load-profile.json` and `ops/evidence/external/load-profile-approval.json`; do not invent observations
- [ ] T240 Create and rehearse core journal, STT/AI, SES, RDS, telemetry, and provider-config-drift outage runbooks in `ops/runbooks/core-journal-outage.md`, `ops/runbooks/provider-outages.md`, and `ops/runbooks/ses-rds-telemetry-outages.md` (FR-113)
- [ ] T241 Create and rehearse secrets, migration, deployment, audio, lifecycle backlog, export exposure, S3/KMS, rate-abuse, and cross-user incident runbooks in `ops/runbooks/secrets-migrations-lifecycle.md` and `ops/runbooks/security-operations.md` (FR-113, FR-116)

**Checkpoint**: Same immutable image/config can reach production-equivalent staging; missing external approvals remain explicit blockers.

---

## Phase 16: PWA, Accessibility, Performance, and Human Validation

**Purpose**: Installable responsive shell, cache safety, browser/accessibility proof, declared-load SLOs, and every owned manual procedure.

- [ ] T242 [P] Write service-worker route/cache/update tests proving asset-only precache and network-only API/auth/audio/export/diagnostic behavior in `apps/web/tests/pwa/service-worker.spec.ts` (FR-106)
- [ ] T243 Implement `injectManifest` service worker with immutable shell-only caching, safe navigation fallback, and explicit offline state in `apps/web/src/pwa/service-worker.ts` (FR-106)
- [ ] T244 [P] Create installable manifest, icons, theme, HTTPS install checks, and no private metadata in `apps/web/public/manifest.webmanifest` and `apps/web/src/pwa/installability.ts`
- [ ] T245 Implement responsive/mobile-browser application shell and protected loading/error/empty/degraded regions in `apps/web/src/app/AppShell.tsx` (FR-106, FR-107)
- [ ] T246 Implement update prompt that preserves/locks recoverable IndexedDB drafts or warns before risk, with no general offline synchronization in `apps/web/src/pwa/UpdateCoordinator.tsx`
- [ ] T247 Build Playwright current/previous Chrome/Edge/Firefox/Safari and mobile viewport matrix, storage-denial/private-mode/update/network cases in `tests/acceptance/browser-matrix.config.ts`
- [ ] T248 [P] Add axe-core automation for every core/degraded/error/destructive screen and WCAG issue evidence encoder in `tests/accessibility/axe-core.spec.ts` (FR-107; SC-022)
- [ ] T249 [P] Implement k6 core/manual/history/search/overview/review 10,000-memo load profile with p50/p95/p99/error outputs in `tests/performance/core-load.js` (FR-108, FR-109; SC-013)
- [ ] T250 [P] Add PostgreSQL search/report query-plan and index-regression checks under declared data shape in `tests/performance/query-plans.spec.ts` (FR-109)
- [ ] T251 [P] Test 60-second audio memory/concurrency/backpressure admission and safe degradation at 20 concurrent assisted operations in `tests/performance/audio-concurrency.js`
- [ ] T252 Implement authenticated synthetic SLI probes and month-long core/STT/AI-separated availability calculation in `tests/performance/slo-probes.ts` (FR-110, FR-112; SC-014)
- [ ] T253 Run manual first-use validation: Product research owner; release-candidate staging; ≥20 representative first-time adults across supported mobile/desktop; signup→verify→privacy onboarding→first manual memo unaided; evidence fields protocol/version, anonymous code, browser/device, completion/time/help only in `ops/evidence/manual/sc001-first-use.json`; pass ≥18/20 under 5 minutes; prerequisites T047–T083, T232, T247 (SC-001)
- [ ] T254 Run manual capture-speed validation: Product research owner; release-candidate staging; ≥20 onboarded representative users; standardized synthetic scenario after warm-up; evidence anonymous code/duration/completion/error only in `ops/evidence/manual/sc002-manual-speed.json`; pass ≥19/20 under 30 seconds with valid confirmation; prerequisites T064–T083, T232 (SC-002)
- [ ] T255 Run manual voice/text comprehension validation: Product + privacy owners; release-candidate staging; ≥12 participants spanning supported locales/accents/mobile; notice→synthetic recording→uncertainty review→correction→confirm→explain authority; evidence coded answers/status, no audio/transcript in `ops/evidence/manual/assisted-comprehension.json`; pass ≥11/12 understand provider/audio/draft/confirmation and zero auto-confirm; prerequisites T125–T151, T232
- [ ] T256 Run manual detector-guidance validation: Privacy owner; release-candidate staging; ≥12 representative participants; supplied synthetic matches + benign false positives→resolve/abandon→read limitation; evidence fixture IDs/actions/comprehension only in `ops/evidence/manual/detector-guidance.json`; pass all resolve/abandon and ≥10/12 understand best-effort limitation; prerequisites T125–T126, T202–T209, T232 (SC-017)
- [ ] T257 Run independent manual accessibility audit: Accessibility owner; release-candidate staging; keyboard-only, VoiceOver/Safari, NVDA/Firefox, TalkBack/Chrome, ≥3 assistive-tech users; every core/degraded/error/destructive journey; evidence issue ID/WCAG/build/browser/AT/severity only in `ops/evidence/manual/sc022-accessibility.json`; pass zero critical/high and all applicable WCAG 2.2 AA; prerequisites T059, T060, T074, T075, T078, T091, T102, T103, T112, T121, T132, T138, T141, T142, T157, T169, T174, T181, T232, T245, T246, T247, T248 (SC-022)
- [ ] T258 Run manual mobile/PWA validation: QA lead; release-candidate staging; current/previous iOS Safari + Android Chrome across ≥6 device/browser combinations; install/reload/update/60s recording/background/network/draft recovery/cache audit; evidence build/device/browser/scenario/hash only in `ops/evidence/manual/mobile-pwa.json`; pass every required flow, zero private cache, work preserved per spec; prerequisites T242–T247, T232
- [ ] T259 Run manual account-deletion comprehension validation: Product + privacy owners; release-candidate staging; ≥12 participants; grace/backup/provider explanation→cancel→controlled irreversible fixture; evidence anonymous comprehension codes/state transitions only in `ops/evidence/manual/account-deletion-comprehension.json`; pass ≥11/12 distinguish live purge, backup aging, provider pending and no misleading complete state; prerequisites T164–T201, T232
- [ ] T260 Run approved normal-load performance/SLO suite and store content-safe environment/profile/percentile results in `ops/evidence/performance/release-candidate.json` (FR-108–FR-110; SC-013, SC-014)

**Checkpoint**: Automated/browser/human criteria are owned and measurable; no screenshots or participant content become evidence.

---

## Phase 17: Production-Equivalent Release Evidence and Final Convergence

**Purpose**: Real-service closure, full P1/P2 journeys, restore/deletion proof, traceability, mandatory gates, and signed go/no-go.

- [ ] T261 Run real-service Better Auth + deployed RDS signup/login/reset/restoration/revocation/expiry/30-day policy and two-account isolation suite; record safe evidence in `ops/evidence/real-services/better-auth-rds.json` (FR-001–FR-003, FR-105; SC-003, SC-004, SC-015)
- [ ] T262 Run real-service SES verification/reset delivery, generic copy, bounce mapping, and telemetry exclusion against controlled inboxes; record safe evidence in `ops/evidence/real-services/ses.json` (FR-001, FR-105)
- [ ] T263 Run real-service pinned OpenAI STT supported-format/limit/error/latency suite under approved project and prove terminal audio deletion; record no content in `ops/evidence/real-services/openai-stt.json` (FR-043–FR-046, FR-085, FR-105; SC-008, SC-009)
- [ ] T264 Run real-service pinned OpenAI extraction strict-schema/ambiguity/invalid/payload-minimization/latency suite under ZDR and record safe evidence in `ops/evidence/real-services/openai-extraction.json` (FR-032–FR-039, FR-085, FR-086, FR-105; SC-007)
- [ ] T265 Run real-service S3/KMS export isolation/encryption/stream/expiry/version-deletion and completeness/reproduction suite; record safe evidence in `ops/evidence/real-services/s3-kms-export.json` (FR-091–FR-094, FR-105; SC-019, SC-020)
- [ ] T266 Run real-service ECS/ALB/Secrets Manager immutable deployment, rollback, runtime secret, encrypted ephemeral storage, task-kill audio cleanup, and migration suite; record safe evidence in `ops/evidence/real-services/ecs-runtime.json` (FR-105, FR-116)
- [ ] T267 Run real-service OpenTelemetry/CloudWatch allowlist/canary/alert/core-provider-separation suite; record safe evidence in `ops/evidence/real-services/observability.json` (FR-078, FR-079, FR-105, FR-112; SC-016)
- [ ] T268 Run real-service isolated RDS PITR operational drill: RPO≤24h/RTO≤8h, account-first + memo suppression, valid neighbors survive, no network before checks, all cleanup blockers retain/alert/retry, restore copy destroyed before token removal; record safe evidence in `ops/evidence/operations/sc021-restore-drill.json` (FR-100, FR-114, FR-115; SC-021)
- [ ] T269 Create `pnpm acceptance:full-mvp` deployed-production-equivalent journey suite spanning signup→verification→onboarding→manual/text/voice→confirmation→history/edit/traversal→labels/search→overview/review→export→record/account deletion in `tests/acceptance/full-mvp.spec.ts` (SC-023)
- [ ] T270 Invoke `pnpm acceptance:full-mvp` against exact release-candidate staging and write all-story evidence to `ops/evidence/release/full-mvp-journey.json` (FR-105, FR-118; SC-023)
- [ ] T271 Invoke production-equivalent degraded companion with STT/AI independently and jointly unavailable while manual create/view/edit/archive/restore/delete succeeds; write evidence to `ops/evidence/release/degraded-mvp-journey.json` (FR-031, FR-105, FR-111; SC-010, SC-011, SC-023)
- [ ] T272 Verify all production provider decision records match exact config/model/project, approvals remain valid, no silent substitution occurred, and missing/expired evidence blocks release in `ops/evidence/release/provider-approvals.json` (FR-084–FR-086; SC-018)
- [ ] T273 Run manual operational go/no-go: Release owner with named privacy/security/SRE/data/accessibility sign-off; exact production candidate + staging mirror; review evidence/provider/restore/SLO/hooks/findings/rollback; signed role/hash/build/environment evidence only in `ops/evidence/manual/operational-go-no-go.json`; pass unanimous required roles and zero blocking gap; prerequisites T238, T260–T272 (SC-025)
- [ ] T274 Generate machine-auditable implementation/test/manual/owner/environment/evidence status matrix from this file in `ops/evidence/release/requirement-ownership.json` (FR-119; SC-024)
- [ ] T275 Verify FR-001..FR-120, SC-001..SC-026, US1..US8, Constitution I..X, eight manual procedures, and six external dependencies have zero unmapped/unowned entries using `scripts/verify/traceability.mjs` and store result in `ops/evidence/release/traceability.json` (FR-119, FR-120; SC-024, SC-025)
- [ ] T276 Verify every checked task has target deliverable plus scanned evidence, every manifest hash resolves, and no content/secret/canary appears using `scripts/verify/evidence.mjs` and `ops/evidence/release/evidence-verification.json` (FR-104, FR-118, FR-119)
- [ ] T277 Run full blocking `pnpm verify` in constitutional order against immutable release candidate with no fake fallback and store gate summary in `ops/evidence/release/verification-gates.json` (FR-117, FR-120)
- [ ] T278 Run mandatory Spec Kit artifact/implementation gates and read-only `/speckit.analyze`; require zero CRITICAL/HIGH, zero cycles, zero constitution conflicts, zero real-service/restore/privacy gaps in `ops/evidence/release/spec-kit-gates.json` (FR-120; SC-025)
- [ ] T279 Create signed content-safe release manifest with image/config/migration/provider/currency/tzdb/evidence hashes and promote only after T273–T278 pass in `ops/evidence/release/release-manifest.json`

**Checkpoint**: Feature 001—not an early slice—is complete only after every task/evidence/gate above passes.

---

## Dependencies and Execution Order

### Phase Dependency Graph

```text
P1 Repository/toolchain
 └─→ P2 Contracts/domain/test foundation
      └─→ P3 PostgreSQL/persistence
           └─→ P4 US1 identity/onboarding (T048 compatibility proof blocks rest)
                └─→ P5 US2 manual journal
                     ├─→ P6 versioned traversal ─→ P7 US6 search/labels
                     ├─→ P8 US4 current month
                     ├─→ P9 US7 monthly review
                     ├─→ P10 US3 assisted capture ─→ P11 US5 failure/degradation
                     └─→ P12 US8 export/deletion ─→ P13 backup/deletion reconciliation
P7–P13 ─→ P14 privacy/security hardening
P1–P14 ─→ P15 production infrastructure
all UI + P15 staging ─→ P16 PWA/accessibility/performance/manual validation
P1–P16 + external approvals ─→ P17 real-service/full-release evidence
```

- No dependency cycle exists.
- Phase 6 must finish before any history/search acceptance claims stable multi-page traversal.
- T048 depends explicitly on reconciled T032, T033, T042, T046, and T047. Its failure blocks T049–T063 and forbids custom session-token workarounds.
- T176 is required before purge workers T177/T178; real irreversible-deletion acceptance remains open until T185–T200 and T268.
- Phase-local acceptance suite creation always precedes its invocation: US1 T062→T063, US2 T067→T083, US3 T150→T151, US4 T114→T115, US5 T162→T163, US6 T105→T106, US7 T123→T124, US8 T183→T184, full MVP T269→T270.
- T151/T184 explicitly cannot close real-provider/restore requirements; only Phase 17 can.

### Parallel-Safe Examples

| Scope | Safe concurrent tasks after prerequisites | Why no collision |
|---|---|---|
| Setup | T003–T011 | Distinct config/workflow/test-support targets; T012 serializes shared `package.json` scripts |
| Domain | T013, T016, T019, T021, T023, T025–T027, T029–T031 | Independent contract/test/type files |
| Database declarations | T033–T036, T039 | Separate schema modules and test harness; migrations wait |
| US1 tests | T049, T052, T053, T055, T058 after T048 | Separate auth/email/session/onboarding/web targets |
| US2 tests | T064–T067 | Separate contract, recovery, concurrency, and acceptance files |
| US6 | T094–T096; T102 after label contract | Separate label/search/privacy/UI targets |
| US4 | T107–T108 | Property oracle and DB/export golden oracle are independent |
| US7 | T116–T117 | Property oracle and integration golden oracle are independent |
| US3 | T125, T127, T130, T133, T136, T143, T146–T147 | Separate privacy/provider/text/audio/confirmation/real-adapter test targets |
| US5 | T152, T154, T155 | Failure inventory, browser recovery, and server commit-point targets differ |
| US8 | T164, T167, T171, T175 | Export contract/storage, account state, and suppression contract targets differ |
| Backup | T185, T189, T191, T194 | Ledger, inventory, cleanup, and restore contracts are separate |
| Privacy/security | T202, T205, T207, T211, T212, T214 | Separate boundary/canary/surface/isolation/auth/input suites |
| Infrastructure | T219–T226 | Separate OpenTofu modules; composition waits until each passes |
| PWA/performance | T242, T244, T248–T251 | Separate service-worker, manifest, accessibility, load, DB-plan, and audio targets |

### Delivery Strategy

1. P1–P3 create tested foundation.
2. US1 and US2 create first usable manual journal slice, but **not Feature 001 MVP completion**.
3. P6–P14 add full required product and safety behavior with per-story gates.
4. P15–P16 prove deployability, PWA/accessibility/performance, and human criteria.
5. P17 alone can claim complete Feature 001 after real-service, restore, degraded, traceability, hook, analysis, and signed release evidence all pass.

---

## Machine-Auditable Functional Requirement Traceability

| Requirement | Implementation task(s) | Verification/evidence task(s) |
|---|---|---|
| FR-001 | T050–T052 | T047–T049, T212, T261–T262 |
| FR-002 | T050, T054 | T047–T048, T053, T212, T261 |
| FR-003 | T054 | T047–T048, T053, T261 |
| FR-004 | T056, T060 | T055, T058, T062–T063, T253 |
| FR-005 | T056–T057, T060 | T055, T062–T063 |
| FR-006 | T018, T074 | T055, T064, T083 |
| FR-007 | T056, T060 | T055, T058, T062–T063 |
| FR-008 | T015, T051, T054 | T049, T061, T212, T261 |
| FR-009 | T024, T051, T056 | T023, T049, T055 |
| FR-010 | T038, T041 | T040, T061, T211, T261 |
| FR-011 | T034, T068 | T032, T064, T066, T083 |
| FR-012 | T034, T068, T074 | T064, T083 |
| FR-013 | T018, T068 | T016, T064, T082 |
| FR-014 | T018, T068 | T016, T064, T082 |
| FR-015 | T017–T018 | T016, T032, T082 |
| FR-016 | T068, T074 | T064, T083 |
| FR-017 | T018, T109, T118, T165 | T107, T116, T122, T164 |
| FR-018 | T020, T068, T074 | T019, T064, T082 |
| FR-019 | T020, T131, T140 | T019, T130, T150–T151 |
| FR-020 | T020, T068, T140 | T019, T064, T130, T150–T151 |
| FR-021 | T020, T056, T110, T119 | T019, T055, T107–T108, T116–T117 |
| FR-022 | T076–T078 | T066, T080, T083 |
| FR-023 | T024, T068, T075–T077 | T023, T066, T083 |
| FR-024 | T034, T068, T075 | T032, T064, T066 |
| FR-025 | T070, T076, T109, T119 | T066, T108, T117 |
| FR-026 | T070, T076, T088, T110, T119 | T066, T092, T108, T117 |
| FR-027 | T076–T078 | T066, T080, T083 |
| FR-028 | T079, T081, T177, T195 | T080, T187, T194, T268 |
| FR-029 | T024, T068 | T023, T066, T155, T261 |
| FR-030 | T070, T085–T091 | T084, T092–T093, T105–T106, T269–T270 |
| FR-031 | T156 | T083, T152, T162–T163, T271 |
| FR-032 | T131–T132, T144 | T130, T143, T150–T151, T264 |
| FR-033 | T128–T129, T134–T144 | T127, T136, T150–T151, T263–T264 |
| FR-034 | T131, T140–T141 | T130, T143, T150–T151, T264 |
| FR-035 | T018, T020, T140, T144 | T016, T019, T130, T143 |
| FR-036 | T140, T145 | T127, T130, T136, T147, T264 |
| FR-037 | T139, T145, T160 | T136, T150–T151, T271 |
| FR-038 | T134–T135, T145 | T136, T148, T163, T263 |
| FR-039 | T144–T145 | T143, T161, T264 |
| FR-040 | T034, T072, T109, T119, T165 | T032, T064, T108, T117, T164 |
| FR-041 | T071–T073, T081, T156 | T065, T080, T154, T163, T271 |
| FR-042 | T072, T081, T144 | T080, T148, T182 |
| FR-043 | T137–T138 | T133, T148, T258, T263 |
| FR-044 | T134–T135 | T136, T148, T263, T266 |
| FR-045 | T134–T135 | T148, T199, T263, T266 |
| FR-046 | T137–T139, T160 | T133, T136, T154, T163 |
| FR-047 | T024, T144 | T023, T143, T155, T264 |
| FR-048 | T071, T131 | T065, T130, T154 |
| FR-049 | T015, T145, T157 | T127, T136, T162–T163 |
| FR-050 | T142 | T127, T130, T136, T149, T255 |
| FR-051 | T056, T097 | T055, T094, T105–T106 |
| FR-052 | T097–T098, T101–T102 | T094, T104–T106 |
| FR-053 | T097 | T094, T104 |
| FR-054 | T097, T099 | T094–T095, T105–T106 |
| FR-055 | T097, T102 | T094, T207, T105–T106 |
| FR-056 | T099–T100, T103 | T095–T096, T104–T106 |
| FR-057 | T100, T103 | T095, T104–T106 |
| FR-058 | T100, T103 | T095, T105–T106 |
| FR-059 | T088, T090–T091, T103 | T084, T092–T093, T105–T106 |
| FR-060 | T038, T041, T100 | T096, T104, T211 |
| FR-061 | T109–T111 | T107–T108, T114–T115 |
| FR-062 | T109–T110 | T107–T108, T114–T115 |
| FR-063 | T109–T112 | T107–T108, T114–T115 |
| FR-064 | T109–T110 | T107–T108, T114–T115 |
| FR-065 | T018, T109–T112 | T107–T108, T114–T115 |
| FR-066 | T118–T121 | T116–T117, T123–T124 |
| FR-067 | T118–T121 | T116–T117, T123–T124 |
| FR-068 | T118–T121 | T116–T117, T123–T124 |
| FR-069 | T118–T121 | T116–T117, T123–T124 |
| FR-070 | T122 | T116, T123–T124 |
| FR-071 | T111, T121, T160 | T113–T115, T123–T124, T161 |
| FR-072 | T108–T110, T117–T119, T165 | T164, T265 |
| FR-073 | T203, T207 | T202, T217, T256 |
| FR-074 | T132, T138, T203 | T202, T207, T217, T256 |
| FR-075 | T126, T203 | T125, T202, T206, T217 |
| FR-076 | T126, T208–T209 | T125, T202, T256 |
| FR-077 | T203, T208 | T202, T207, T217, T275 |
| FR-078 | T149, T204–T205 | T026, T096, T182, T202, T206, T217, T267 |
| FR-079 | T204 | T026, T206, T217, T267 |
| FR-080 | T014–T015, T128, T140 | T013, T127, T214 |
| FR-081 | T038, T041 | T040, T061, T104, T180, T211, T261 |
| FR-082 | T038, T041 | T031, T061, T080, T104, T180, T211, T261, T265 |
| FR-083 | T004, T007, T225 | T216, T266–T267, T277 |
| FR-084 | T235 | T236, T272, T275 |
| FR-085 | T236 | T146–T147, T263–T264, T272 |
| FR-086 | T128, T149, T209 | T127, T146–T147, T217, T263–T264 |
| FR-087 | T213 | T212, T214, T218, T261 |
| FR-088 | T054, T168, T173, T177–T178 | T053, T180, T212, T261, T265 |
| FR-089 | T015, T145, T204 | T202, T206, T217–T218 |
| FR-090 | T210 | T199, T217, T273 |
| FR-091 | T165–T169 | T164, T183–T184, T265 |
| FR-092 | T165, T169 | T164, T183–T184, T265 |
| FR-093 | T166, T168–T169 | T164, T170, T183–T184, T265 |
| FR-094 | T167–T170, T223 | T164, T180, T265 |
| FR-095 | T076–T078, T181 | T066, T080, T183–T184 |
| FR-096 | T176–T177, T186 | T175, T182, T185, T187, T268 |
| FR-097 | T172–T174 | T171, T183–T184, T259 |
| FR-098 | T172, T178–T179 | T171, T180, T183–T184, T187, T268 |
| FR-099 | T172, T177–T179 | T171, T175, T187, T268 |
| FR-100 | T176–T178, T186, T188, T190, T192–T200, T222–T223, T227 | T175, T185, T187, T189, T191, T194, T201, T268 |
| FR-101 | T174, T181 | T183–T184, T259, T273 |
| FR-102 | T172, T178–T179 | T171, T183–T184, T268 |
| FR-103 | T081, T135, T166, T177–T179, T199 | T080, T148, T170, T187, T191, T194, T268 |
| FR-104 | T028, T182, T204–T205 | T027, T206, T217, T276 |
| FR-105 | T219–T232 | T261–T272, T277 |
| FR-106 | T243–T247 | T242, T258, T269–T270 |
| FR-107 | T245 | T248, T257, T269–T270 |
| FR-108 | T245, T249 | T253–T254, T260 |
| FR-109 | T088, T100, T110, T249–T250 | T092, T260 |
| FR-110 | T226, T252 | T260, T267, T277 |
| FR-111 | T071–T073, T153–T160 | T031, T065, T152, T154–T155, T161–T163, T271 |
| FR-112 | T204, T226, T252 | T206, T240, T267 |
| FR-113 | T240–T241 | T267, T273 |
| FR-114 | T197, T200, T222, T227 | T199, T268 |
| FR-115 | T195–T200 | T194, T201, T268 |
| FR-116 | T228–T231, T241 | T216, T266, T273, T277 |
| FR-117 | T008, T012, T230 | T216–T218, T277 |
| FR-118 | T028, T062, T067, T105, T114, T123, T150, T162, T183, T269 | T027, T063, T083, T106, T115, T124, T151, T163, T184, T270–T271, T276 |
| FR-119 | T238, T274 | T027–T028, T273, T275–T276 |
| FR-120 | T230, T275–T279 | T217–T218, T268, T273, T277–T278 |

**Coverage assertion**: FR rows = 120; unmapped FRs = 0. T275 must machine-check this assertion before release.

---

## Machine-Auditable Success-Criterion Traceability

| Criterion | Mode and owner | Task(s) |
|---|---|---|
| SC-001 | Manual + real; Product research owner | T253 |
| SC-002 | Manual; Product research owner | T254 |
| SC-003 | Automated + real; backend/QA owners | T066, T155, T261 |
| SC-004 | Automated + real; backend/QA owners | T066, T082, T261 |
| SC-005 | Automated; domain owner | T016, T018, T082, T108 |
| SC-006 | Automated; domain/API/UI owners | T107, T116, T122, T164 |
| SC-007 | Automated + real; provider owner | T130, T146–T147, T150–T151, T264 |
| SC-008 | Automated + real; provider owner | T133, T136, T146, T150–T151, T263 |
| SC-009 | Automated + real + operational; provider/SRE owners | T134–T135, T148, T263, T266 |
| SC-010 | Automated + operational; reliability owner | T156, T162–T163, T271 |
| SC-011 | Automated + real; web/backend owners | T065, T154–T155, T163, T271 |
| SC-012 | Automated; reporting owner | T107–T108, T116–T117 |
| SC-013 | Automated + real; performance owner | T239, T249–T250, T260 |
| SC-014 | Operational; SRE owner | T226, T252, T260, T267 |
| SC-015 | Automated + real; security owner | T061, T080, T104, T180, T211, T261, T265 |
| SC-016 | Automated + real; privacy owner | T205–T206, T217, T267 |
| SC-017 | Automated + manual; privacy owner | T207–T208, T217, T256 |
| SC-018 | Real + operational; privacy/provider owner | T235–T236, T263–T264, T272 |
| SC-019 | Automated + real; export owner | T164–T165, T265 |
| SC-020 | Automated + real + operational; data/SRE owners | T170–T171, T187, T226, T265, T268 |
| SC-021 | Operational; data operations/SRE owners | T185–T200, T268 |
| SC-022 | Automated + manual; accessibility owner | T248, T257 |
| SC-023 | Automated + real + operational + manual; release owner | T063, T083, T106, T115, T124, T151, T163, T184, T269–T273 |
| SC-024 | Automated + manual review; release owner | T238, T274–T275 |
| SC-025 | Automated + operational + manual; release owner | T273, T275, T277–T279 |
| SC-026 | Automated + real; history/backend owner | T084–T093, T105–T106, T261, T269–T270 |

**Coverage assertion**: SC rows = 26; unmapped SCs = 0. T275 must machine-check this assertion before release.

---

## User Story Traceability

| Story | Build/test phase | Story acceptance creation → invocation | Final production-equivalent closure |
|---|---|---|---|
| US1 Start private journal | T047–T061 | T062 → T063 | T253, T261–T262, T269–T270 |
| US2 Accurate manual journal | T064–T082 | T067 → T083 | T254, T261, T269–T271 |
| US3 Words/voice reviewed draft | T125–T149 | T150 → T151 | T255, T263–T264, T269–T271 |
| US4 Current-month overview | T107–T113 | T114 → T115 | T249–T250, T260, T269–T270 |
| US5 Safe failure/degradation | T152–T161 | T162 → T163 | T267, T271 |
| US6 Organize/find | T094–T104 | T105 → T106 | T249–T250, T260, T269–T270 |
| US7 Monthly review | T116–T122 | T123 → T124 | T249–T250, T260, T269–T270 |
| US8 Export/delete | T164–T182 plus T185–T200 | T183 → T184 | T259, T265, T268–T270, T272 |

---

## Constitution 2.0.0 Control Traceability

| Principle/control | Implementation ownership | Verification/evidence ownership |
|---|---|---|
| I. Privacy by Default | T025–T026, T125–T126, T149, T202–T210 | T096, T182, T202, T205–T209, T217, T256, T267 |
| II. User-Confirmed Truth | T022, T034, T072, T131–T145 | T021, T032, T130, T136, T143, T150–T151, T264 |
| III. Temporary Audio | T134–T135, T137–T138 | T133, T136, T148, T199, T258, T263, T266 |
| IV. Graceful Degradation | T156–T160 | T083, T152–T155, T161–T163, T271 |
| V. User Data Ownership | T165–T181, T186–T200 | T164, T170–T175, T182–T185, T187–T194, T259, T265, T268 |
| VI. Architecture Discipline | T010, T014, T025, T128, T167, T176, T204 | T010, T013, T127, T185, T272, T275 |
| VII. Reliability | T024, T041, T068, T071–T081, T085–T091, T144, T153–T160 | T023, T040, T065–T067, T084, T092, T143, T152, T154–T155 |
| VIII. Security | T004, T007, T038, T041, T050–T054, T211–T216, T225 | T040, T061, T104, T180, T211–T218, T261, T265–T267 |
| IX. Evidence-Based Quality Gates | T008, T012, T027–T028, story suites, T230, T274–T279 | all story invocations, T217–T218, T261–T273, T275–T278 |
| X. Scope Discipline | T010, T017–T018, T109, T118, T122, T156, T243 | T013, T016, T107, T116, T122, T207, T275 |

**Constitution exceptions**: none. Any future exception requires separate governance action; no task may invent one.

---

## Manual Evidence Ownership

| Procedure | Task | Owner | Environment/sample | Evidence path | Pass rule |
|---|---|---|---|---|---|
| First-use success | T253 | Product research owner | RC staging; ≥20 first-time adults | `ops/evidence/manual/sc001-first-use.json` | ≥18/20 unaided under 5m |
| Manual capture speed | T254 | Product research owner | RC staging; ≥20 onboarded users | `ops/evidence/manual/sc002-manual-speed.json` | ≥19/20 valid under 30s |
| Voice/text comprehension | T255 | Product + privacy owners | RC staging; ≥12 locale/accent/mobile mix | `ops/evidence/manual/assisted-comprehension.json` | ≥11/12 understand boundary/draft/confirmation; zero auto-confirm |
| Detector guidance/limits | T256 | Privacy owner | RC staging; ≥12 participants | `ops/evidence/manual/detector-guidance.json` | all resolve/abandon; ≥10/12 understand best effort |
| Accessibility audit | T257 | Independent accessibility owner | RC staging; keyboard + VoiceOver/NVDA/TalkBack; ≥3 AT users | `ops/evidence/manual/sc022-accessibility.json` | zero critical/high; applicable WCAG 2.2 AA passes |
| Mobile/PWA usability | T258 | QA lead | RC staging; ≥6 iOS/Android browser/device combinations | `ops/evidence/manual/mobile-pwa.json` | all required flows; zero private cache; declared recovery preserved |
| Account-deletion comprehension | T259 | Product + privacy owners | RC staging; ≥12 participants | `ops/evidence/manual/account-deletion-comprehension.json` | ≥11/12 distinguish live/backup/provider states; no false complete |
| Operational go/no-go | T273 | Release owner + privacy/security/SRE/data/accessibility signers | Exact production candidate + staging mirror | `ops/evidence/manual/operational-go-no-go.json` | unanimous required sign-off; zero blocker |

**Manual criteria count**: 8. **Unowned manual criteria**: 0. Participants use synthetic, non-sensitive scenarios only.

---

## External Launch Dependency Traceability

| Dependency | Binding task | Fail-closed artifact/status |
|---|---|---|
| AWS account/environment/DNS identifiers | T233 | `ops/evidence/external/aws-environment.json`; missing blocks staging/production promotion |
| Exact dependency patch/model/registry/tzdb versions | T234 | `ops/evidence/external/dependency-review.json`; unresolved/expired blocks build |
| OpenAI ZDR/training/endpoint administrative approval | T236 | protected `ops/evidence/external/openai-zdr-approval.json`; absent blocks STT/AI launch |
| SES production/domain authorization | T237 | protected `ops/evidence/external/ses-production-approval.json`; absent blocks real signup acceptance |
| Named human/team owners | T238 | `ops/owners.yaml`; placeholders block evidence/release closure |
| Validated normal-load profile | T239 | `ops/evidence/external/load-profile-approval.json`; unvalidated assumptions block SLO claim |

**External dependency tasks**: 6. Task generation does not fabricate or mark any approval complete.

---

## Task-Plan Validation Rules

- Total tasks must remain sequential T001–T279 with no duplicate or gap.
- Every checklist line must contain checkbox, task ID, optional valid `[P]`, required `[USx]` only inside story phases, concrete deliverable, and exact backticked path.
- `[P]` tasks must not share target files, migrations, generated contracts, or mutable infrastructure state with another concurrently eligible `[P]` task.
- Tests/harnesses precede or run alongside implementation; every acceptance invocation follows command registration T012 and its story suite creation task.
- Unmapped FRs = 0; unmapped SCs = 0; unowned manual criteria = 0; unbound external dependencies = 0 before release.
- Checked task without real deliverable and scanned evidence remains incomplete regardless of checkbox state.
- Fakes never close T261–T268, SC-018, SC-021, or any production-provider requirement.
- `/speckit.implement` must not begin until mandatory after-tasks hook and read-only `/speckit.analyze` both report zero CRITICAL/HIGH findings and zero cycles.

## Notes

- Early US1/US2 slice is useful but is not complete Cashmemo MVP.
- Feature 001 completes only at T279 after every P1/P2 story, degraded path, provider, deletion/restore, PWA, accessibility, performance, privacy/security, ownership, and evidence gate passes.
- No task restores historical architecture, code, schema, contract, test, infrastructure, or numbering.
