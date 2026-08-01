# Constitution Compliance Assessment: Money Memo Foundation

**Constitution**: Cashmemo v1.0.0  
**Assessment date**: 2026-08-01  
**Status**: PASS WITH EXCEPTION C-07 after authoritative specification correction.

## I. Privacy by Default

**Planned controls**

- No banking field exists in memo, label, draft, API, export, or TablesDB schema.
- No UI, API, domain model, persistence schema, or export requests, encourages, infers, or provides
  dedicated fields for banking credentials, account/routing numbers, card details, verification
  codes, banking tokens, statements, or government identifiers.
- Every free-text entry carries clear adjacent warning. All free-text boundaries run exact,
  versioned Pattern Set v1 before persistence; blocking matches never persist.
- Warning/block preserves byte-exact unsaved local input and correction path. Candidate content and
  match derivatives reach no analysis beyond synchronous in-memory detector and no telemetry,
  analytics, inference, or crash-reporting boundary.
- Amount, note, label name, search term, fingerprint/key material, cursor, purge token, export,
  owner/record IDs, HTTP body/query/header, and Appwrite error/query are absent from telemetry.
- Domain sensitive value types redact `Debug`; HTTP errors expose field/rule and, only for HTTP-422
  Pattern Set rejection, an optional published safe detector ID—never candidate content/derivatives.
- OTel Collector uses allowlist/redaction before TLS OTLP export to OpenObserve.
- Browser API/data caching is disabled; Dexie is limited to compose recovery.
- Purge sweep enumerates all live/storage/diagnostic surfaces.

**Evidence**: `test-strategy.md` privacy canaries; real OpenObserve/Appwrite/container scan;
`data-model.md` surface inventory; security review on any telemetry/error change.

**Assessment**: Pass with explicit exception C-07. Corrected FR-010/FR-098 preserve product
prohibition and trust-boundary rejection for declared high-confidence patterns while forbidding a
false universal-detection claim. Pattern Set v1, warnings, false-result disclosure, draft
preservation, and diagnostic isolation are testable. Yet Principle I literally prohibits accepting,
transmitting, or storing every prohibited value; a finite detector can miss one. Governance forbids
reinterpretation, so C-07 records violation, rationale, risks, owner, review, and removal plan.

## II. User-Confirmed Truth

- Manual submit is explicit confirmation and creates confirmed memo directly.
- Server stores no unconfirmed draft.
- Dexie draft remains local and distinct from server state.
- No voice, STT, AI, extraction, enrichment, or background reclassification exists.

**Evidence**: API has no draft endpoint; data model has no server draft; compose/browser tests.

**Assessment**: Pass.

## III. Temporary Audio

No audio input, storage, provider, route, table, permission, or test fixture. Future audio work
requires separate specification.

**Assessment**: Not applicable; scope exclusion verified.

## IV. Graceful Degradation

- Manual create/read/update/delete has no STT, AI, Redis, or external inference dependency.
- Appwrite's vendor-internal Redis does not enter Cashmemo domain/application contract.
- Suppression-store outage cannot make expired memo accessible; physical delete waits and alerts.
- Purge scheduler outage cannot make deadline-expired memo accessible; access fallback exists.
- Mutation failure preserves Dexie draft and surfaces named unavailable capability/error code.

**Evidence**: full acceptance suite with no STT/AI/shared app cache; scheduler/ledger failure tests.

**Assessment**: Pass. User-visible deadline inaccessibility remains unconditional. Physical work
uses corrected operational SLO, automatic idempotent recovery, heartbeat/overdue monitoring,
24-hour breach alerts, and retained operational evidence.

## V. Data Ownership

- Versioned JSON export preserves exact amounts, currency scale, occurrence semantics, lifecycle,
  timestamps, and label references; excludes internal metadata and Recently Deleted.
- Export fence implements accepted-instant consistency; no partial output.
- 30-day Recently Deleted; exact deadline inaccessibility; scheduled/fallback physical purge.
- Independent ledger contains exactly keyed/non-reversible `deletion_token`, `purged_at`, and
  `removal_not_before_at`. Time alone never deletes token; verified destruction of every capable
  backup gates cleanup and prevents older-backup resurrection.
- Backup maximum exactly 30 days; token dies when last containing backup is verified gone.
- Quarterly real restore drills and 100-cycle pre-release real qualification.
- No provider training/inference integration exists.

**Evidence**: export JSON Schema/OpenAPI, backup runbooks, real restore reports, deletion suites.

**Assessment**: Pass. FR-061/SC-020 define normal-availability measurement and outage evidence;
no outage can extend logical access or suppress overdue/SLO-breach alerting.

## VI. Architecture Discipline

- One Rust modular monolith, one codebase/binary image with HTTP/purge/reconcile command modes.
- Domain crate imports no Axum, Appwrite, storage, browser, React, or telemetry types.
- Ports owned by application/domain; adapters implement Appwrite Auth/TablesDB, suppression store,
  clock, and telemetry.
- Appwrite pinned and accessed only by supported REST/GraphQL APIs. No direct internal MongoDB.
- Backup is opaque quiesced volume/system snapshot, not semantic Mongo access.
- No microservices. Independent suppression object store is storage adapter required by restore
  correctness, not separately deployed domain service.

**Evidence**: planned source dependency checks, architecture tests, Compose review.

**Assessment**: Pass.

## VII. Reliability

- UUID per compose session, durable Dexie retention, per-user unique creation ID.
- Immutable keyed fingerprint survives edits and time; matching retry returns current state.
- Explicit revision on Money Memo and Label; Appwrite transaction conflict closes race.
- Whole submission, label counts, state versions, and memo change commit atomically.
- Export fence supplies actual consistency instead of undocumented snapshot claim.
- No rounding, truncation, page-size clamp, partial export, silent fallback, or draft loss.
- Scheduled purge and token writes are idempotent.

**Evidence**: 1,000 retry/concurrency tests, canonical crypto vectors, real transaction race tests,
export stress, scheduler failure/recovery tests.

**Assessment**: Pass.

## VIII. Security

- Appwrite Account response establishes owner; client has no owner field.
- Backend-private TablesDB; scoped server secret runtime-only.
- Every adapter method requires owner or is a narrowly scoped worker/reconcile operation.
- Other-owner and unknown/purged ID produce indistinguishable response.
- Boundary JSON schemas reject unknown/immutable fields and aggregate safe validation errors.
- Fingerprint, cursor, purge token, session, and telemetry use separate keys/domain separators.
- Missing auth/key/ledger fails closed.
- Secrets mounted/managed outside source and scanned in CI.

**Evidence**: full cross-user matrix, secret scanning, key failure tests, direct TablesDB denial.

**Assessment**: Pass.

## IX. Quality Gates

- Eight user stories remain independently testable.
- Required gate order is explicit in `test-strategy.md`.
- Real Appwrite, real OpenObserve, real suppression store, real browser Dexie, and real backup
  restore close integration requirements; mocks only accelerate unit tests.
- Every requirement has command/result evidence path and named owner.
- 20-user study and quarterly/100-cycle restore procedures are explicit.
- Cryptographic evidence is construction + threat review, never automated exhaustive proof.

**Assessment**: Pass.

## X. Scope Discipline

- No voice, STT, AI, insight, bank connection/data, recurring memo, conversion, report/budget,
  attachment, sharing, microservice, or general offline synchronization.
- PWA caches shell assets only. Dexie stores feature-specific draft/retry only.
- No application Redis. Appwrite vendor topology is not extended.

**Assessment**: Pass.

## Governance and exception status

One constitutional exception exists: C-07 in `complexity-exceptions.md`.

- Sensitive-content change is specification correction plus constitution exception. Constitution
  still prohibits product solicitation, dedicated fields, transmission/persistence of detected
  high-confidence values, and sensitive diagnostics. Correction removes untestable claim that
  finite software understands every possible meaning in arbitrary human text. Unknown false
  negative is accepted exception risk, not authorized collection intent; discovered prohibited data
  is handled as privacy incident. Product and Security own amendment/removal plan.
- Physical-deletion change is specification correction. Constitution requires explicit, tested
  retention/deletion behavior but contains no disaster-independent 24-hour physical guarantee.
  Exact deadline inaccessibility remains unconditional; physical deletion is measurable SLO under
  normal availability with automatic recovery, alerts, and evidence.
- Pagination is resolved by version-guarded live traversal. Exactly-once completion is guaranteed
  only while membership and order stay unchanged. Every page and continuation bind one opaque
  result-set version; create/lifecycle/purge/occurrence and current-query membership changes require
  refresh, while membership-neutral non-sort edits preserve traversal. Purged/expired rows never
  return for cursor history. No snapshot-membership promise exists.

`complexity-exceptions.md` documents C-01 through C-06 architecture complexity and C-07 governance
exception. No remaining specification contradiction exists; C-07 remains visible until constitution
amendment or arbitrary-free-text removal.

## Final gate result

**Planning/design gate**: PASS WITH EXCEPTION C-07. Physical-purge correction fully aligns;
free-text correction follows recorded exception governance.  
**Task-generation gate**: PASS WITH EXCEPTION C-07. No remaining specification contradiction.
Existing task IDs/order remain stable; affected deliverables were reconciled before implementation.
