# Implementation Plan: Money Memo Foundation

**Branch**: `001-money-memo-foundation` | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)

**Input**: Approved feature specification at `specs/001-money-memo-foundation/spec.md`

## Summary

Build complete manual Money Memo lifecycle as PWA-capable Next.js application backed by one
Rust modular monolith. Appwrite 1.9.6 supplies authentication and TablesDB persistence through
supported REST APIs only. Domain code owns validation, authorization policy, time semantics,
revisions, idempotency, lifecycle, pagination, export fencing, and stable errors. Browser uses
TanStack Query for server state, Zustand only for transient interface/compose state, and Dexie
only for recoverable compose drafts and retry identity.

Design uses Appwrite transactions for atomic domain mutations, application keyset cursors for
stable compound order, a per-user export fence for accepted-instant JSON export, hourly
idempotent purge execution, and independent encrypted deletion-suppression storage so an older
backup cannot resurrect purged memos. No Redis, voice, STT, AI, bank integration, currency
conversion, general offline synchronization, or microservice split is introduced.

## Technical Context

**Language/Version**: Rust 1.97.1 with Rust 2024 edition; TypeScript 5.x in strict mode; Node.js
24 LTS

**Primary Dependencies**: Axum 0.8, Tokio 1.x, `serde`, `reqwest`, `rust_decimal`, `uuid`,
`hmac`/`sha2`, AEAD key wrapping, `tracing`, OpenTelemetry; Next.js 16.2.11 App Router, React,
Tailwind CSS 4, shadcn/ui, TanStack Query 5, Zustand 5, Dexie 4, Temporal polyfill

**Storage**: Self-hosted Appwrite 1.9.6 TablesDB with Appwrite-owned MongoDB adapter, reached by
Cashmemo through REST/GraphQL APIs only; IndexedDB/Dexie only for local compose drafts and retry
state; encrypted S3-compatible backup-control bucket for suppression ledger and backup manifests;
Cashmemo has no MongoDB driver, credential, query, dump, or direct access

**Testing**: Rust unit/property/contract/integration tests, Tokio paused time, Vitest, Testing
Library, Playwright, real pinned Appwrite integration stacks, real OpenObserve leak scans, real
backup/restore qualification

**Target Platform**: Modern evergreen browsers; Linux containers deployed by Docker Compose
through Dokploy

**Project Type**: Web application plus one modular-monolith backend binary. Same backend image
runs HTTP and scheduled purge command modes.

**Performance Goals**: Search/filter under 1 second p95 at 10,000 memos; complete 10,000-memo
export; stable pagination through 10,000 memos; successful export fencing under 100 attempted
mutations/second; median memo creation under 30 seconds; median find task under 15 seconds

**Constraints**: Exact decimal money; owner isolation on every operation; zero sensitive values
in diagnostics; stale writes rejected; deadline inaccessibility independent of scheduler;
24-hour physical-purge SLO under normal service availability; automatic idempotent outage
recovery and breach alerting; no partial export; API list cache TTL `0`; no background API cache
persistence or general offline sync

**Scale/Scope**: Personal journals up to 10,000 memos per user; eight specified user stories;
three memo lifecycle states; user-managed categories and Money Spaces; synchronous export

## Constitution Check

### Pre-research gate

| Principle | Gate | Result |
|---|---|---|
| I. Privacy by Default | No banking-data solicitation or dedicated fields; adjacent free-text warning; published finite detector; no completeness claim; no sensitive diagnostics | PASS WITH EXCEPTION C-07: arbitrary free-text false negatives can violate literal universal prohibition |
| II. User-Confirmed Truth | Manual submission is explicit confirmation; server stores no unconfirmed draft | PASS |
| III. Temporary Audio | No audio path exists | NOT APPLICABLE |
| IV. Graceful Degradation | Manual CRUD has no STT, AI, Redis, or shared-cache dependency | PASS |
| V. Data Ownership | Versioned export, Recently Deleted, purge, bounded backups, suppression reconciliation | PASS |
| VI. Architecture Discipline | Domain crates import no Axum/Appwrite/browser/UI types; supported Appwrite APIs only; modular monolith | PASS |
| VII. Reliability | Stable creation identity, keyed fingerprint, transactions, caller revisions, durable local draft | PASS |
| VIII. Security | Appwrite-derived principal, explicit owner predicates, deny-by-default TablesDB access, boundary schemas | PASS |
| IX. Quality Gates | Formatting through acceptance evidence, including real dependencies and privacy/deletion suites | PASS |
| X. Scope Discipline | No excluded feature or speculative service | PASS |

### Post-design gate

Design retains every pre-research control. Independent suppression storage and export fencing
add complexity only where deletion and point-in-time export require it. Constitution exception
C-07 records why arbitrary free text cannot satisfy Principle I's literal universal prohibition,
accepted risks, controls, owner, and removal condition. `constitution-compliance.md` records
requirement-level evidence. Purge SLO correction needs no constitution exception.

## Architecture

```text
Browser PWA
  Next.js UI
  TanStack Query (server state)
  Zustand (ephemeral UI/compose state)
  Dexie (compose draft + stable retry identity only)
        |
        | HTTPS + HttpOnly Appwrite session cookie
        v
Rust modular monolith
  Axum HTTP adapter
  application use cases + ports
  Money Memo domain
  Appwrite REST adapter ---- Appwrite Auth + TablesDB
  suppression adapter ------ encrypted backup-control bucket
  telemetry adapter -------- OpenTelemetry Collector ---- OpenObserve
        |
        +-- `serve`
        +-- `purge-expired` (same image/codebase; Dokploy hourly schedule)
```

### Boundary rules

- Browser never accesses Money Memo TablesDB rows directly. Tables are deny-by-default; scoped
  backend API key is runtime-only. This prevents direct exposure of fingerprints and internal
  deletion fields.
- Axum authentication adapter validates opaque Appwrite SSR session through supported Account API
  and derives principal. Client-supplied `ownerId` is absent from contracts.
- Every persistence call contains authenticated `owner_id`, including searches, exports, label
  reference checks, scheduler ownership-neutral scans followed by domain guards, and direct ID
  lookups. Other-owner and unknown IDs map to identical `NOT_FOUND` responses.
- Domain has no imports from Axum, Appwrite adapter, IndexedDB, React, or OpenTelemetry.
- Appwrite list calls set `ttl=0`; row writes do not invalidate Appwrite list cache.
- All externally reachable input uses explicit request schemas. Error messages name field and
  rule, never submitted value.

## Core Design Decisions

### Durable creation idempotency

Browser creates one UUIDv4 with `crypto.randomUUID()` when compose session begins and persists
it with draft in Dexie. Reload, timeout, foreground retry, and reconnect reuse it. A different
compose session always gets a new UUID.

Validated creation input is canonicalized with RFC 8785-style deterministic JSON and protected
by HMAC-SHA-256 using a random per-memo 256-bit MAC key. MAC key is AEAD-wrapped under versioned
runtime KEK. Fingerprint remains immutable; KEK rotation rewraps only per-memo key without
changing memo revision or domain timestamps. Missing key fails closed with
`IDEMPOTENCY_VERIFICATION_UNAVAILABLE`; no live-field comparison or duplicate create occurs.

Unique `(owner_id, creation_id)` index closes concurrent races. Matching retry returns current
memo, current lifecycle, and current revision without any write. Mismatch returns
`CREATION_IDENTIFIER_CONFLICT`. Expired pending deletion is first inaccessible and purged; after
physical purge, old creation identity is gone and same identifier may create a new random memo.

### Time model

Persist signed 64-bit UTC epoch microseconds, fixed local wall string, derived local date, and
offset minutes. Validate `wall - offset = instant`. Sort by instant. Filter inclusive ISO local
dates directly against stored local date, independent of viewer zone.

API and export serializers emit every instant only as canonical UTC
`YYYY-MM-DDTHH:mm:ss.SSSSSSZ`. Offset validation accepts `-13:59..+13:59` plus exact `-14:00` and
`+14:00`; no 14-hour value with nonzero minutes is valid. Every `MoneyMemo` DTO carries required
nullable `purgeDeadline`: null for active/archived and canonical non-null UTC for pending deletion.

Ordinary date/time edit retains offset and recomputes instant. Explicit offset-change action
retains wall time and recomputes instant. Recorded-zone display uses wall plus offset; current-
zone toggle derives from instant and writes nothing. Ambiguous fall-back times require explicit
offset choice; nonexistent spring-forward wall times are rejected.

### Pagination and change signal

Use encrypted, authenticated application cursor rather than Appwrite `cursorAfter`, because a
cursor row may be deleted. Cursor binds owner, view, normalized filters/search, page size,
30-minute expiry, first-page result-set version, and last tuple
`(occurrence_instant_us, created_at_us, memo_id)`.

Appwrite query uses lexicographic `OR`/`AND` predicate and three descending order clauses.
Opaque `resultSetVersion` is a keyed digest over owner, normalized view/query digest, one base
membership/order generation, and only search/filter generation dimensions used by that query.
Base generation changes transactionally for creation, archive, restore, deletion request, purge,
and occurrence wall/offset edit. A participating search/filter dimension changes when its field
changes. Every page returns the version. Every continuation supplies it separately and carries the
same value inside the protected cursor. The application checks request, cursor, and recomputed
version before and after the page query; any mismatch discards the page and returns `LIST_CHANGED`
with mandatory refresh. Complete exactly-once traversal is promised only while membership and
ordering remain unchanged. A non-sort-key edit irrelevant to current-query membership preserves
the version and traversal. Purged and expired records are never returned to honor cursor history.
This is version-guarded live keyset traversal, not snapshot isolation.

For Recently Deleted traversal, cursor/version also bind `membershipValidUntil`, the earliest purge
deadline capable of changing that result set. Continuation at or after that instant returns
`LIST_CHANGED` before mapping any row, even when scheduler is disabled.

### Export

`POST /v1/exports/money-memos` builds UTF-8 JSON conforming to
`contracts/export-v1.schema.json`. Successful per-user export-lease commit is exact
`acceptedAt` linearization point. Every memo and label mutation reads and touches same user
state row transactionally; active lease yields retryable `EXPORT_IN_PROGRESS` and preserves
client draft.

While lease is held, export reads owner-scoped rows and label references using internal keyset
pages with cache disabled, serializes complete file into bounded private memory, validates
schema and lease, releases fence, then sends bytes. Any read, lease, memory, or validation
failure sends no file and returns `EXPORT_CONSISTENCY_UNAVAILABLE`. Appwrite snapshot isolation
is not claimed.

Export schema enforces exactly `minorUnitScale` fractional digits through scale 0–4 conditional
branches generated or verified from `contracts/currencies-v1.md`; both too few and too many digits
fail. Every instant is canonical six-digit UTC `Z`, and offset constraints match API/domain rules.

### Lifecycle, purge, and backup suppression

Stored statuses remain exactly `active`, `archived`, `pending_deletion`. `expired` is derived
when `pending_deletion && clock >= purge_deadline`; `purged` means no row. All paths enforce
deadline before data mapping. Access fallback attempts purge then returns same not-found result
as unknown ID.

Purge first makes immediate-purge intent irreversible by setting deadline to current clock in a
transaction. It then writes deletion token to independent suppression store, and only after
durable acknowledgement deletes memo/search data and decrements label reference counts in an
Appwrite transaction. Ledger failure blocks physical deletion but not inaccessibility. Worker
retries idempotently.

Deletion token is versioned HMAC of raw memo ID under separate purge key. Ledger contains exactly
`deletion_token`, `purged_at`, and `removal_not_before_at`; token is keyed, non-reversible, and
contains no owner or memo metadata. `removal_not_before_at` is maximum registered destruction
deadline of inventory-known backups capable of containing the memo and is only earliest cleanup
eligibility, never TTL. Cleanup then verifies destruction of every capable backup and removes the
token only after proof. Failed or unverifiable destruction retains token, alerts, retries, and
blocks cleanup. Suppression storage has no time-based lifecycle deletion for current or noncurrent
token objects. Raw ID and owner never leave Appwrite for ledger. Hourly Dokploy job uses same
backend binary. Each run exhaustively selects all expired rows rather than relying on missed-run state, so
the first successful run after recovery automatically and idempotently drains overdue work.
Privacy-safe signals are `purge_last_success_age_seconds`, `purge_oldest_overdue_age_seconds`,
aggregate attempted/deleted/failed counts, and run/request IDs. Warn at 12 hours, page before 24
hours, emit a breach alert at 24 hours, and retain run evidence until the corresponding SLO review.
No memo ID, owner ID, deletion token, purge timestamp, or field content enters those signals.

Normal service availability means at least one scheduled executor can start the hourly command and
both Appwrite TablesDB and suppression storage accept required supported operations throughout the
deadline-to-deletion interval. Outage monitoring does not make an overdue record compliant: every
record older than 24 hours still emits a breach alert, remains logically inaccessible, and is
purged after recovery. Access-triggered purge remains fallback only.

### Sensitive free-text boundary

Cashmemo exposes no banking field and never requests, encourages, or infers bank credentials,
account/routing numbers, card details, verification codes, banking tokens, bank statements, or
government identifiers. Every persisted free-text control—memo note, Category name, and Money
Space name—shows the adjacent warning required by FR-098. Search entry shows the same warning in
its privacy help and is never persisted.

Client runs Pattern Set v1 before transmission; server independently reruns it in a no-body-log
HTTP boundary for bypass resistance. Structurally valid blocking input returns HTTP 422
`PRIVACY_INPUT_REJECTED`; body may contain only field, correction guidance, detector-set version,
and published safe detector ID. It never includes candidate/matched value, normalization output,
offset, substring, hash, or derivative. Blocking matches never persist. Warning matches keep the
value local while UI offers edit/remove/continue; continuing needs no persisted or transmitted
attestation. Both outcomes preserve the byte-exact unsaved Dexie/compose value and a correction
path. Except for synchronous in-memory detector execution, candidate text and match derivatives
never enter analysis, inference, telemetry, analytics, crash reporting, HTTP/persistence
diagnostics, or evidence artifacts.

`research.md` R-17 is the authoritative Pattern Set v1 registry. Detector version may be reported
to UI, but telemetry records only generic `PRIVACY_INPUT_REJECTED`/`PRIVACY_INPUT_WARNED`, request
ID, route template, client/server boundary, and service version—not detector ID, field content,
match location, hash, or normalized derivative. Pattern evidence reports fixture-bounded false
positives/negatives honestly; no semantic-completeness claim is permitted.

### Search and case-insensitive uniqueness

- Category and Money Space store `name_key = Unicode NFKC case-fold(trim(name))`; unique
  `(owner_id, kind, name_key)` covers active and deactivated labels. Appwrite has no documented
  expression/case-insensitive unique index, so normalization is application-owned and unique
  compound index supplies race safety.
- Note search stores derived `note_search = strip_diacritics(case_fold(NFKD(note)))` in memo row.
  Backend normalizes trimmed terms, requires two characters, combines terms with AND, and uses
  Appwrite substring `contains`; it verifies exact normalized match before returning. Raw term
  is sent only in body and never captured by HTTP/persistence telemetry. Real Appwrite p95 test
  at 10,000 rows is release gate.
- Pending-deletion and expired rows are excluded before search result mapping. Search support
  disappears atomically with memo row at purge.

## Mutation and Consistency Matrix

| Operation | Expected revision | Appwrite transaction | List generation | Sort generation | Export fence |
|---|---:|---|---:|---:|---|
| Create memo | n/a; creation ID | memo + two label counts + user state | +1 | unchanged | required |
| Edit non-time field | yes | memo + label counts if reference changes + user state | +1 | unchanged | required |
| Edit occurrence/offset | yes | memo + user state | +1 | +1 | required |
| Archive/restore/delete | yes | memo + user state | +1 | unchanged | required |
| Restore Recently Deleted | yes | memo + user state | +1 | unchanged | required |
| Purge | derived/confirmed | ledger first; memo delete + label counts + user state | +1 | unchanged | required |
| Label create/rename/state/delete | yes except create | label + user state; delete requires count zero | +1 | unchanged | required |

Every conflict maps to stable domain/API code. Memo stale conflict includes current memo resource
in dedicated `current` member, not in error message. Label mutations also use caller-visible
revision because labels are mutable entities.

## Project Structure

### Documentation

```text
specs/001-money-memo-foundation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── test-strategy.md
├── constitution-compliance.md
├── complexity-exceptions.md
└── contracts/
    ├── openapi.yaml
    ├── export-v1.schema.json
    └── currencies-v1.md

docs/operations/
├── backup-retention.md
└── backup-restore.md
```

### Planned source layout

```text
apps/web/
├── src/app/
├── src/components/
├── src/features/money-memos/
├── src/lib/api/
├── src/lib/compose/
└── tests/

backend/
├── Cargo.toml
├── crates/domain/
├── crates/application/
├── crates/appwrite-adapter/
├── crates/http-adapter/
├── crates/suppression-adapter/
├── crates/telemetry/
└── crates/cashmemo/

infra/
├── compose/
├── appwrite/
├── otel-collector/
└── dokploy/

tests/
├── acceptance/
├── integration-appwrite/
├── privacy/
├── performance/
└── restore/
```

**Structure Decision**: Monorepo with frontend application and Rust workspace. Rust workspace
produces one `cashmemo` binary with `serve`, `purge-expired`, and `restore-reconcile` commands.
Crate boundaries enforce inward dependencies while deployment remains modular monolith.

## Delivery Sequence

1. Pin toolchain/images; create Appwrite schema/index provisioning; establish auth principal,
   domain errors, clocks, money/time value objects, secret/key ports, and privacy-safe telemetry.
2. Implement category/Money Space model and starter seeding; create/list/detail Money Memos with
   Dexie-backed compose recovery and durable creation identity.
3. Add revision-checked edits, explicit currency/offset changes, archive and restore.
4. Add keyset list/search/filter views, result-set-version refresh, Recently Deleted, scheduled and
   access-triggered purge, suppression ledger, and backup reconciliation.
5. Add fenced versioned export and PWA shell caching with API network-only policy.
6. Run full gate order: format/lint, type check, unit, real integration, privacy, performance,
   acceptance, 20-user study, and 100 real restore qualification cycles.

Task generation remains a separate workflow; later finding reconciliation may update existing task
deliverables without renumbering or implementing them.

## Pre-Task Reconciliation Report

1. **Sensitive free text—specification correction plus constitution exception C-07.** FR-010,
   FR-070, FR-098, FR-099, and SC-013 now define product-boundary prohibition, adjacent warning,
   exact Pattern Set v1 behavior, input preservation, correction path, and diagnostic isolation.
   They explicitly prohibit complete semantic-detection claims. Because Principle I literally
   prohibits accepting/transmitting/storing any prohibited value and governance forbids
   reinterpretation, false negatives require explicit C-07 rather than a claimed compliance pass.
2. **Physical deletion—resolved by specification correction, not exception.** FR-061 and SC-020
   preserve exact scheduler-independent inaccessibility and define 24 hours as operational SLO
   under normal service availability. Automatic idempotent recovery, heartbeat/overdue detection,
   breach alerts, and retained operational evidence are required. Access purge stays fallback.
3. **Pagination—resolved by result-set version.** FR-032 guarantees exactly-once traversal only
   while membership and ordering remain unchanged. Every page and continuation bind one result-set
   version. Creation, lifecycle changes, purge, occurrence edits, and current-query membership
   changes invalidate continuation and require refresh; membership-neutral non-sort edits preserve
   it. Purged and expired rows remain inaccessible under FR-060/FR-063.
4. **Suppression cleanup—resolved by verified-destruction gate.** FR-065 permits exactly
   `deletion_token`, `purged_at`, and `removal_not_before_at`. Time only establishes earliest
   eligibility; every capable backup must be proven destroyed before token removal. Failure retains
   token, alerts, retries, and blocks cleanup. No token TTL/provider lifecycle exists.
5. **Boundary contracts—resolved.** OpenAPI adds HTTP-422 `PRIVACY_INPUT_REJECTED`, safe detector-ID
   allowlist, canonical six-digit UTC/offset bounds, required conditional `purgeDeadline`, and
   result-set versions. Export schema enforces currency-scale-exact fractional digits.

No remaining specification contradiction blocks task generation. C-07 is documented under
constitution governance and remains visible until its removal condition is met. Existing
`tasks.md` is updated only where these reconciliations change deliverables; IDs/order remain stable.

## Complexity Tracking

One constitution exception, C-07, is recorded for literal universal free-text rejection. Required
architecture complexity and all removal conditions live in `complexity-exceptions.md`; other main
items are independent suppression storage, per-user export fence, derived search normalization,
and transactional label reference counts. Redis and microservices remain absent.
