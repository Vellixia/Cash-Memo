# Test and Acceptance Strategy: Cashmemo MVP

## Purpose

Feature 001 closes only when every story and requirement has implementation ownership plus automated or explicit manual/operational evidence. Checked tasks, mock-only tests, local unit tests, and screenshots without environment metadata are insufficient.

All test data is synthetic. Evidence tooling accepts allowlisted metadata only and rejects financial text, transcripts, audio, emails, detector material, provider payloads, raw URLs, credentials, or exports. Failures refer to fixture IDs and safe reason codes.

## Gate Order

The release pipeline is blocking and ordered:

1. formatting and linting;
2. type checking and generated-contract drift;
3. unit and property/invariant tests;
4. integration and contract tests;
5. privacy and security/isolation tests;
6. browser/PWA acceptance and accessibility;
7. real-provider integration tests;
8. performance/SLO tests;
9. operational deletion/backup/restore/rollback tests;
10. production-equivalent story evidence and manual validation review.

A later pass cannot override an earlier failure. Zero unresolved mandatory hook failures or CRITICAL/HIGH findings is required.

## Test Layers

### 1. Unit tests

Owner: feature implementer; environment: hermetic CI.

- money parser/canonicalizer, currency exponent and overflow validation;
- occurrence tuple validation, future bound, relative date anchor, DST ambiguity/nonexistence;
- memo/draft/audio/export/account state transitions;
- deterministic net, bucket completion, ranking ties, prior-zero comparison;
- product error mapping and content-safe telemetry event builders;
- rule-family detectors with non-sensitive synthetic fixtures;
- PWA form reducers, conflict-preserving draft state, and capability messages.

Pass: 100% named invariant cases pass; changed domain policy has branch coverage and mutation-test target ≥90% for money/time/lifecycle/privacy modules. Coverage is diagnostic, not a substitute for assertions.

### 2. Property/invariant tests

Owner: domain maintainer; environment: hermetic CI; tool: fast-check.

- decimal ↔ minor-unit round trip is exact for every supported currency and valid magnitude;
- invalid sign/zero/precision/overflow is always rejected;
- partition-and-sum never combines currencies and matches a BigInt reference oracle;
- each eligible value appears exactly once per reporting dimension;
- month boundary conversion is stable across generated IANA zones and DST edges;
- state machines accept only declared transitions and terminal purge never returns active;
- same idempotency key/canonical payload returns one ID; altered payload never writes;
- unchanged result-set versions traverse exact keyset order; every list-affecting mutation invalidates the version and no stale continuation yields a page;
- generated ownership substitutions never expose another account;
- error/evidence encoders cannot accept forbidden fields.

Pass: fixed seed set plus at least 10,000 generated cases per core invariant; shrink output contains only safe generated fixture IDs.

### 3. Contract tests

Owner: API maintainer; environment: CI.

- lint/validate OpenAPI 3.1 and all examples;
- generate server/client types and fail on uncommitted drift;
- request/response conformance for enum, nullability, money/time strings, revisions, errors, and lifecycle transitions;
- export v1 canonical JSON/CSV/manifest golden files;
- provider adapter fake implements exactly the project port, while the same suite runs against real provider adapters;
- DB migration schema constraints match data-model invariants.

Pass: no schema warning/error; every public operation has auth, validation, error, and ownership cases; no provider-native type crosses the product contract.

### 4. Integration tests

Owner: backend maintainer; environment: Testcontainers with PostgreSQL 18 and local object/email fakes whose contracts are separately real-verified.

- pinned Better Auth PostgreSQL adapter against the committed 0001/0002/0003 schema with supported model/field mappings, core `token` storage/lookup, verification/reset, `expiresIn`/`updateAge`, 30-day middleware revocation, current/other/all revocation, reauthentication grants, and enumeration-safe responses; schema/query capture proves zero pending Better Auth migrations and no unsupported token-hashing adapter;
- authentication-storage tests prove Better Auth's native PostgreSQL UUID mode can create all core rows through the required `gen_random_uuid()` defaults, `email_verified` is the sole boolean verification authority, server-side `name` remains the fixed non-profile value, credential-only account rows leave every OAuth token field null, email verification creates no verification row, reset identifiers never equal/contain the raw token under `storeIdentifier="hashed"`, core reset `value` contains only the internal synthetic user UUID, and consumed/expired rows are deleted without token leakage to captured logs or evidence;
- transaction-local RLS with non-owner role and cross-account FK rejection;
- concurrent memo/draft/preferences/label edits;
- atomic memo+idempotency result under lost responses and duplicate requests;
- search GIN index, intersection filters, lifecycle exclusion, keyset order, version/query-bound cursors, and `RESULTS_CHANGED` under create/delete/restore/archive/occurrence/search-filter mutation races;
- report queries over golden datasets, archived inclusion, deleted/draft exclusion;
- DB-leased worker claim/retry/crash/reclaim/deduplication;
- export snapshot and object deletion;
- lifecycle sweepers, exact account/memo deletion-token reconciliation, backup-lineage verification, and blocked suppression cleanup.

Pass: real PostgreSQL constraints and RLS produce expected results; no test relies only on an in-memory database.

### 5. Real-provider integration tests

Owner: provider integration owner; environment: protected production-equivalent staging with approved non-production provider projects and synthetic content.

Required real services:

| Service | Required proof |
|---|---|
| Better Auth + RDS PostgreSQL | verified signup/login/reset/revocation using deployed app and real DB; zero core-schema drift; supported session `token` storage/query behavior; email-verification non-persistence/replay/expiry; hashed reset identifier plus consume/replay/expiry/cleanup; OAuth-only fields null; cookie cache/stateless storage disabled; 7d refresh/30d absolute policy tested with controlled clock plus live smoke; no custom token-hashing lookup |
| AWS SES | verified domain/configuration, real delivery to controlled test inboxes, generic email copy, bounce mapping, no message/user content in app telemetry |
| OpenAI STT | pinned model/endpoint accepts all supported browser formats, duration limits/errors map correctly, no training/retention admin evidence, raw audio deleted after each terminal path |
| OpenAI extraction | pinned snapshot, `store:false`, strict schema, invalid/ambiguous cases, payload-minimization proxy, ZDR admin evidence |
| RDS | Multi-AZ, migration, PITR backup, monitoring, isolated restore |
| S3/KMS | export isolation, encrypted write/read, same-origin stream, cancel/expiry version deletion, content-free suppression ledger |
| ECS/ALB/Secrets Manager | real deployment, health rollback, runtime secrets, encrypted ephemeral storage, task termination audio cleanup |
| OpenTelemetry/CloudWatch | allowlisted metrics/traces/logs, alerts, seeded-value absence, core/provider status separation |

Mocks/fakes remain useful for failure injection but cannot close these rows. Pass: exact approved provider decision version and evidence hash recorded; no provider gap or expired approval.

### 6. Browser/PWA acceptance

Owner: QA automation owner; environment: deployed staging over HTTPS; tool: Playwright.

- current/previous major Chrome, Edge, Firefox, Safari; representative mobile viewport and real iOS Safari/Android Chrome device pass before launch;
- install prompt/manifest/icon/service-worker update; private/incognito fallback; browser storage denial/quota/clear behavior;
- app-shell asset-only cache audit; API/auth/audio/export never returned from Cache Storage;
- signup/onboarding/manual/assisted/history/lifecycle/labels/search/report/export/deletion journeys;
- page reload, app close/reopen, network loss, duplicate tap/response loss, multi-tab stale edit;
- 60-second recording countdown/auto-stop and permission denial/interruption;
- loading, error, empty, no-match, degraded, incomplete, privacy-warning, conflict, and destructive-confirmation states.

Pass: all P1/P2 acceptance scenarios pass against deployed services; browser-specific known limitations are documented without breaking required journeys.

### 7. Privacy tests

Owner: privacy test owner; environment: CI plus production-equivalent staging.

- static interface/schema scan finds zero dedicated prohibited fields/solicitation and verifies adjacent guidance at every arbitrary input;
- every v1 detector rule runs before each covered browser/server persistence/provider boundary and blocks matched synthetic candidate without persisting/transmitting it;
- voice test proves explicit STT disclosure and immediate transcript detector before persistence/AI;
- a capture-proxy records outbound field names/length classes—not content—and proves provider minimization;
- seeded canary values traverse success/failure/retry/invalid-provider/error/export/deletion paths; scans of logs, metrics, traces, client reports, URLs, evidence, job metadata, and unrelated provider captures find zero canary occurrence;
- detector precision/recall is measured against versioned synthetic multilingual corpus and UI/product copy never claims completeness;
- logger/telemetry compile-time/runtime API rejects bodies, arbitrary objects, query values, detector details, and provider payloads.

Pass: zero prohibited collection surfaces, zero crossed matched boundary, zero canary disclosure, published best-effort limitation and measured corpus result. Any failure blocks release.

### 8. Security/isolation tests

Owner: security owner; environment: CI/staging.

- IDOR matrix for every memo/draft/label/search/report/export/audio/deletion endpoint with another account's valid UUID;
- RLS direct-query tests, missing/forged transaction context, connection-pool context reset, maintenance-role separation;
- session fixation/rotation/revocation, CSRF/origin, cookie flags, reset replay, verification replay, brute/rate limits, enumeration timing/shape;
- malicious OpenAPI/provider payloads, oversized strings/audio, MIME spoofing, ZIP/CSV injection, SQL/search metacharacters;
- dependency/image/IaC/SBOM/secret scans; CSP and security headers; least-privilege IAM/KMS/S3 policies;
- export recent-auth and object-key isolation; deletion irreversible-state authorization.

Pass: zero unauthorized read/write/existence leak; zero committed secret; no unresolved CRITICAL/HIGH finding.

### 9. Failure-injection tests

Owner: reliability owner; environment: CI/staging with fault proxy.

- STT unavailable/timeout/rate limit/invalid response after audio accepted;
- AI unavailable/timeout/invalid schema/contradictory output after text/transcript preserved;
- DB deadlock/connection loss before and after commit; lost HTTP response; duplicated job delivery;
- SES failure, S3 write/read/delete failure, KMS denial, worker crash/lease expiry;
- browser network interruption during draft save/audio upload/confirm;
- continuation after occurrence edit/create/delete/restore/archive/filter-field change; stale cursor returns `RESULTS_CHANGED` with no page, then clean restart completes;
- process termination while audio exists; sweeper delay; clock advance to expiry;
- calculation query failure proves no partial/stale value labeled current.

Pass: manual core remains operational when accelerator providers fail; no duplicate authoritative memo; no lost declared draft; no partial confirmation; explicit safe failure state.

### 10. Operational/restore tests

Owner: SRE/operations owner; environment: isolated production-equivalent AWS staging.

- environment bootstrap from empty account/project prerequisites;
- forward migration, failed migration, rollback/safe-forward, ECS circuit breaker;
- backup creation, point-in-time restore, session invalidation, exact `money_memo`/`account` token application, re-purge, release checklist;
- `removal_not_before_at` cleanup tests with automated recovery windows, prohibited manual/final/copied/replicated snapshot policy, AWS Backup inventory, active isolated restore copies, inventory outage, alert/retry, and token/key-version retention;
- record/draft/audio/transcript/AI/export/account/provider/backup lifecycle per trigger;
- quarterly RPO/RTO drill, single-AZ/DB failover, provider outage runbook, purge backlog alert;
- temporary audio task kill and abandoned-flow expiry; object-version deletion audit;
- incident drill for discovered prohibited persisted content using only protected evidence.

Pass: declared RPO/RTO and deletion SLOs achieved; no individually purged memo or deleted account restored; no suppression token removed while any capable or unverifiable copy exists; isolation/totals exact; all alerts/runbooks actionable.

### 11. Performance/SLO tests

Owner: performance owner; environment: production-equivalent staging, release-sized ECS/RDS, synthetic accounts.

Normal-load profile: 1,000 DAU assumption, 100 requests/second short burst, 30 sustained core requests/second, 20 concurrent assisted operations, accounts at 10,000 memos with realistic filters/currencies. Revalidate profile from observed pre-launch beta traffic before production claim.

- k6 core API p50/p95/p99/error; browser manual-interactive and navigation timings;
- search/report golden-account latency; index/plan regression;
- 60-second audio memory/concurrency limits and backpressure;
- job backlog and deletion/export completion under normal load;
- month-long availability calculation from synthetic probes, core separate from STT/AI.

Pass: SC-013 and FR-108/109 targets; no audio memory exhaustion; core 99.5% SLO instrumentation proven.

### 12. Manual usability and accessibility

Only criteria requiring human perception are manual. Each has exact ownership/evidence below.

| Validation | Owner | Environment / participants | Procedure | Content-safe evidence | Pass/fail |
|---|---|---|---|---|---|
| First-use success (SC-001) | Product research owner | release-candidate staging; ≥20 representative first-time adults across supported mobile/desktop mix; no production data | participant receives task only; signup, verify, privacy onboarding, first manual memo; moderator does not assist; timer from open to confirmation | study protocol/version, anonymous participant code, device/browser, completion/time/help flag; no entered values/screens containing content | ≥18/20 complete unaided under 5 min |
| Manual capture speed (SC-002) | Product research owner | same or separate ≥20 onboarded representative users | create structured memo from a standardized non-sensitive scenario after warm-up | anonymous code, duration, completion/errors only | ≥19/20 under 30 sec and valid confirmation |
| Voice/text comprehensibility | Product + privacy owners | ≥12 participants spanning supported locales/accents and mobile devices | read privacy/provider notice, record synthetic phrase, review uncertainty, correct draft, confirm; then explain what AI did and whether confirmed automatically | coded comprehension answers and status, no recording/transcript | ≥11/12 correctly state audio/provider boundary, draft status, and confirmation authority; zero observed auto-confirm |
| Detector guidance/limitations | Privacy owner | ≥12 representative participants | enter provided synthetic detector fixtures and benign false-positive candidates; resolve/abandon; review limitation copy | rule fixture ID, action success, comprehension result | all can resolve/abandon; ≥10/12 understand best-effort limitation; no completeness claim |
| Accessibility manual audit (SC-022) | Accessibility owner independent of implementer | release-candidate staging; keyboard-only, VoiceOver/Safari, NVDA/Firefox, TalkBack/Chrome; include ≥3 users with relevant assistive-tech experience | execute every core journey and degraded/error/destructive state; audit focus, announcements, labels, contrast, recording timer | issue IDs, WCAG criterion, build/browser/AT, severity, pass/fail; no journal content | zero critical/high issue; all applicable WCAG 2.2 AA checks pass or formally non-applicable |
| Mobile/PWA usability | QA lead | iOS Safari and Android Chrome current/previous supported devices, ≥6 device/browser combinations | install/open/reload/update, record at 60s, background/foreground, interrupted network, recover draft | build/device/browser, scenario status, artifact hash | all required flows pass; no API/user content cached; work preserved per spec |
| Account deletion comprehension | Product + privacy owners | ≥12 participants on staging | request deletion, describe grace/backup/provider timing, cancel; repeat fixture through irreversible state with controlled account | anonymous comprehension codes and state-transition evidence | ≥11/12 distinguish live purge, backup aging, provider pending; no misleading complete state |
| Operational go/no-go | Release owner with privacy/security/SRE sign-off | exact production candidate and staging mirror | review evidence manifest, provider approvals, restore drill, SLO, hooks/findings, rollback | signed role approvals, evidence hashes, environment/build IDs | unanimous required roles; zero blocking gap |

Human participants must never use real financial, bank, card, identity, or credential content. Voice recordings are synthetic and follow the same deletion lifecycle.

## Success Criteria Evidence Matrix

Legend: **A** automated, **R** real-service, **O** operational drill/SLO, **M** manual.

| SC | Modes | Primary evidence |
|---|---|---|
| SC-001 | M+R | ≥20 first-use study on deployed real auth/email/persistence |
| SC-002 | M | ≥20 post-onboarding timing study |
| SC-003 | A+R | concurrent duplicate/lost-response tests against real PostgreSQL deployment |
| SC-004 | A+R | multi-client stale revision suite |
| SC-005 | A | property tests + DB/export golden registry fixtures |
| SC-006 | A | generated multi-currency API/UI/export scan; zero scalar combination |
| SC-007 | A+R | versioned representative text corpus against pinned real AI; correction state counts |
| SC-008 | A+R | supported-format/accent corpus against pinned real STT; latency/failure counts |
| SC-009 | A+R+O | four audio terminal paths plus task-kill/expiry probe |
| SC-010 | A+R+O | fault-proxy outage journey with deployed providers disabled |
| SC-011 | A+R | browser/network/DB commit-point matrix and IndexedDB/server draft checks |
| SC-012 | A | deterministic golden dataset, timezone/DST/prior-zero cases |
| SC-013 | A+R | k6 + browser timings on release-sized staging with 10,000-memo accounts |
| SC-014 | O | synthetic probe month calculation; core/STT/AI separately reported |
| SC-015 | A+R | endpoint/RLS/S3/audio/deletion two-account matrix |
| SC-016 | A+R | seeded canary scan across every diagnostic/evidence channel |
| SC-017 | A+M | interface/schema static scan + limitation comprehension review |
| SC-018 | R+O | signed provider decision records and administrative control evidence |
| SC-019 | A+R | snapshot counts/checksums/schema and independent aggregate reproduction |
| SC-020 | A+R+O | controlled-clock lifecycle tests plus deployed backlog/SLO measurement |
| SC-021 | O | quarterly isolated PITR restore drill with exact memo/account suppression plus cleanup blocked by any capable or unverifiable artifact |
| SC-022 | A+M | axe-core plus manual AT matrix |
| SC-023 | A+R+O+M | story evidence manifests include success/degraded/privacy paths |
| SC-024 | A+M | generated FR/SC ownership matrix reviewed by release owner |
| SC-025 | A+O+M | hook/analyze/security/privacy/restore/provider go-no-go manifest |
| SC-026 | A+R | version/query-bound traversal concurrency matrix, `RESULTS_CHANGED`, stable unchanged keyset, and zero inaccessible rows |

## Production-Equivalent End-to-End Journey

One release-candidate run must use real staging equivalents for auth, SES, RDS, STT, AI, S3, telemetry, and backup controls:

```text
new account → verification email → login → privacy onboarding/preferences
→ structured manual memo → typed natural-language draft → review/correction/confirm
→ voice (60s-capable) → temporary audio → real STT → transcript
→ real AI structured draft → correction → explicit confirm
→ history → edit conflict check → archive/restore → labels → search/filter
→ paginate unchanged history → mutate occurrence/lifecycle → verify `RESULTS_CHANGED` → refresh traversal
→ current overview → monthly review → versioned export/download
→ Recently Deleted/restore/immediate purge
→ account deletion grace/cancel → second account grace/purge/provider state
```

Degraded companion run:

```text
disable STT and AI adapters independently and together
→ capability message visible
→ structured manual create/view/edit/archive/restore/delete still succeeds
→ recoverable text/draft preserved
→ no duplicate or partial authoritative record
```

No production customer data is used. Provider accuracy is measured separately from product state safety.

## Evidence Manifest

Each artifact record contains only:

```text
evidenceId, storyIds, requirementIds, successCriterionIds,
buildDigest, gitCommit, environmentId, region, deployedConfigVersion,
providerDecisionVersions, currencyRegistryVersion, tzdbVersion,
testCommandOrProcedureId, startedAt, finishedAt, coarseResult,
safeFixtureSetVersion, artifactSha256, reviewerRole, reviewedAt
```

Environment metadata also records ECS task definition, database engine/migration version, browser/device version, feature flags, and normal-load profile. Artifact bodies are access-controlled, retention-limited, and scanned before acceptance. A content scan failure quarantines the artifact and fails the gate; it is never attached to an issue/support ticket.

## Requirement Ownership Closure

Before `/speckit.implement` can complete Feature 001, generated coverage must map all FR-001..FR-120 and SC-001..SC-026 to:

- implementing module/path/task;
- automated test ID or manual/operational procedure ID;
- accountable owner role and assigned person/team;
- target environment and real-provider requirement;
- evidence artifact ID;
- current result.

Missing implementation, test, owner, environment, or evidence is a blocking gap even if a task checkbox is marked.
