# Complexity Exceptions and Removal Conditions

Entries C-01 through C-06 are justified design complexities, not constitution violations. C-07 is
the explicit Feature 001 constitution exception required by Cashmemo Constitution governance.

## C-01: Independent deletion-suppression object storage

**Complexity**: Encrypted S3-compatible backup-control bucket plus adapter/keyring/manifest
coordination outside Appwrite rollback unit.

**Why needed**: Restore of older Appwrite snapshot would also restore older Appwrite-hosted ledger
and erase knowledge of later purges. That can resurrect deleted memo. Canonical token must survive
rollback independently.

**Risks**: Cross-system operation is not atomic; executor/Appwrite/bucket outage delays physical
deletion beyond 24-hour operational SLO; key and retention coordination increase operations burden.
Outage never extends logical accessibility.

**Controls**: Make purge intent/deadline irreversible first, durable token second, Appwrite delete
last. Ledger failure keeps memo inaccessible but not physically deleted. Conditional idempotent
writes, independent encrypted key escrow, daily inventory, fail-closed restore. Hourly full overdue
selection needs no missed-run cursor; first healthy run resumes automatically. Stale heartbeat,
12-hour backlog warning, pre-24-hour page, 24-hour breach alert, and privacy-safe recovery evidence
prove overdue detection and clearance without memo/owner/token identifiers. Ledger stores exactly
keyed `deletion_token`, `purged_at`, and `removal_not_before_at`; no TTL/provider lifecycle removes
token. Cleanup requires verified destruction of every resurrection-capable backup, with retain,
alert, retry, and blocked cleanup on failed verification.

**Owner**: Platform/Operations; Security owns key/retention review.

**Removal condition**: Appwrite offers supported restore-external/protected deletion ledger or
verified point-in-time deletion-reapply facility that survives older restore and enforces exact
retention. Remove adapter/bucket only after 100 real migration restore cycles prove zero
resurrection and old ledger copies pass verified cleanup.

## C-02: Per-user export fence

**Complexity**: User state row with lease, mutation generation, transaction participation by every
memo/label mutation, bounded in-memory export assembly.

**Why needed**: Appwrite documents atomic transactions/conflicts but not repeatable-read or
multi-page snapshot isolation. Spec requires state at accepted instant and forbids mixed/partial
file.

**Risks**: Briefly blocks same-user writes; forgotten mutation path could bypass fence; central
state row serializes unusual concurrent writes.

**Controls**: Mutation matrix/architecture tests require state touch; active lease returns visible
retryable error preserving draft; short lease with crash expiry; 100 runs at 100 attempted
mutations/second against real Appwrite.

**Owner**: Backend.

**Removal condition**: Pinned Appwrite supported API documents and contract tests an as-of or
repeatable-read snapshot spanning all export pages/tables at accepted timestamp. Migration must
prove exact SC-017 behavior before fence removal.

## C-03: Immutable fingerprint with wrapped per-memo MAC key

**Complexity**: Random key per memo, AEAD wrapping metadata, KEK rotation/escrow workflow.

**Why needed**: Plain digest allows offline guessing; one global HMAC key cannot retire without
breaking durable fingerprints; fingerprint itself may never change after edits.

**Risks**: Key unavailability blocks create/retry; bad rotation can strand fingerprints; key plus
database compromise permits guesses.

**Controls**: Fail closed, golden vectors, key inventory, rewrap coverage, backup-aware retirement,
threat review, incident rotation. Rewrap does not mutate fingerprint/revision/domain timestamp.

**Owner**: Security + Backend.

**Removal condition**: Adopt reviewed managed cryptographic service that supplies per-record
keyed verification, rotation/escrow, and same no-offline-confirmation property without mutable
fingerprint. Real restore/rotation evidence required.

## C-04: Derived normalized note-search shadow

**Complexity**: Sensitive derived `note_search` field, Unicode normalization, substring query,
post-query verification, GraphQL POST privacy path.

**Why needed**: Appwrite full-text search has minimum three characters and keyword/stop-character
semantics; spec requires two-character, case/diacritic-insensitive substring and note-only match.

**Risks**: Duplicates note-derived content inside memo row; contains may scan; raw search variable
reaches Appwrite request body; p95 unproven until real benchmark.

**Controls**: Same row and purge transaction; never DTO/export/log; GraphQL POST body capture
disabled; real log scan; 10,000-row p95 release gate; no external search service preemptively.

**Owner**: Backend + Security.

**Removal condition**: Appwrite provides exact two-character normalized substring semantics with
owner scope, query privacy, purge cleanup, and proven p95. Remove shadow only after dual-read
migration and privacy/performance suite.

## C-05: Transactional label reference counts

**Complexity**: Mutable count on labels and coordinated increments/decrements across memo
create/reference edit/purge.

**Why needed**: Label deletion must be refused when any active/archived/pending memo references it,
including concurrent create/edit. Raw ID references have no Appwrite foreign-key restrict contract.

**Risks**: Count drift if any mutation misses transaction; higher write contention.

**Controls**: All reference changes in transaction, minimum zero, restore full-scan count audit,
race/property tests, permanent delete checks count inside transaction.

**Owner**: Backend.

**Removal condition**: Supported Appwrite relationship constraint guarantees same-owner reference,
atomic restrict-on-delete across all lifecycle rows, and proven concurrent behavior. Reconcile
counts before removal.

## C-06: Application cursor plus generations

**Complexity**: Encrypted cursor, DNF keyset query, owner/query binding, query-relevant generation
dimensions, and opaque result-set version.

**Why needed**: Appwrite cursor is row ID and can fail after anchor purge; no result-set version;
membership/order changes must invalidate traversal while unrelated non-sort edits preserve it.

**Risks**: Key management, query/index complexity, missed generation update, or wrong query-dimension
selection could accept a changed result set or cause unnecessary refresh.

**Controls**: 30-minute TTL, AEAD, key overlap, result-set version in page/request/cursor, real
nested-query/index tests, pre/post version read, mutation-dimension matrix, application
oracle/property tests.

**Owner**: Backend.

**Removal condition**: Appwrite supplies deleted-anchor-safe opaque compound cursor plus owner/query
binding and change signal meeting all interleaving tests. Never replace with offset pagination.

## C-07: Finite detection at arbitrary free-text boundary — constitution exception

**Violated text**: Cashmemo Constitution v1.0.0 Principle I says prohibited data MUST NOT be
requested, accepted, transmitted, or stored and every capable input path MUST reject it. Arbitrary
free text plus a finite detector can produce false negatives, so literal universal compliance
cannot be claimed.

**Approval basis**: Authoritative Feature 001 correction directed on 2026-08-01. Scope is only
manual free-text fields and search in Feature 001; no dedicated banking-data field or future feature
inherits it automatically.

**Rationale**: Manual note and user-owned label text are core feature inputs. Complete semantic
classification across every language, identifier format, obfuscation, and ambiguous number is not
possible. Rejecting every free-text value would remove core feature instead of enforcing privacy.

**Risks accepted**:

- False negative may transmit and persist prohibited data as ordinary user-authored text.
- False positive may block valid note/label text or add warning friction.
- Pattern disclosure may help deliberate evasion; undisclosed patterns would make behavior
  unauditable and violate correction requirement.

**Controls**: Never request, encourage, infer, or provide dedicated fields for prohibited data;
clear adjacent warning; exact versioned Pattern Set v1; client preflight plus server blocking-class
validation; byte-exact draft preservation; correction path; no detector content/derivative in logs,
traces, analytics, inference, crash reports, or evidence; labeled false-result report; privacy
incident handling for prohibited data later discovered; no universal-detection claim.

**Owner**: Product and Security jointly own exception review; Security owns detector/evidence;
feature owner owns warning/correction UX.

**Removal plan**: Product and Security must propose a constitution amendment that explicitly
defines enforceable arbitrary-free-text handling, using constitution versioning and migration-impact
review. Until amendment lands, reapprove C-07 at every material free-text/detector change and at
least annually. Exception ends only when constitution amendment supersedes literal conflict, or
Feature 001 removes arbitrary free text. A future detector improvement alone cannot close exception
unless reviewed evidence establishes complete coverage for constitution's full prohibited set.

## Explicitly rejected complexity

- Application Redis: no concrete need; Appwrite's internal Redis is vendor implementation only.
- Microservices or separate purge service: same Rust binary command mode suffices.
- General offline synchronization/background queue: outside feature; Dexie draft/retry only.
- MVCC memo history for export: retains sensitive old versions and complicates purge.
- External full-text/search engine: not justified before real contains benchmark fails and a new
  reviewed design proves privacy/deletion boundaries.

## Reconciled requirements

- **Pattern Set v1**: finite deterministic validation plus UI warning is normal privacy-boundary
  logic inside existing browser/domain layers; no new service is added. Exact patterns and known
  errors live in `research.md` R-17. Specification correction is covered by constitution exception
  C-07 until constitution wording is amended.
- **24-hour purge SLO**: scheduler already required by lifecycle. Heartbeat, overdue age, breach
  alert, and recovery evidence are operational controls, not new service boundary. Same Rust binary
  and Dokploy schedule remain. This is specification correction, not constitutional exception.
