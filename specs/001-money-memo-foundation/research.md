# Research: Money Memo Foundation

**Date**: 2026-08-01  
**Target**: self-hosted Appwrite 1.9.6, Next.js 16.2.11, Rust 1.97.1

All decisions below preserve approved specification. “Application-level” means Rust
domain/application code plus project-owned adapter, never Appwrite internal MongoDB access.

## R-01: Appwrite authentication and owner isolation

**Decision**: Use Appwrite SSR-style session authentication with `HttpOnly`, `Secure`,
`SameSite=Strict` cookie. Rust creates fresh Appwrite auth client per request, calls supported
Account API, and derives owner from returned account. Request schemas contain no owner field.
Cashmemo TablesDB resources are private to backend; browser cannot fetch rows containing
security/internal fields. Backend uses narrowly scoped server credential and must include
owner predicate/check on every read and write. Direct other-owner and absent records both map
to `NOT_FOUND`.

**Rationale**: Appwrite permissions are grant-based and table permission is ORed with row
permission. Server API keys bypass permissions. Appwrite also lacks field-level hiding, so
direct browser row access would expose creation/purge metadata. Auth through Appwrite plus
application owner enforcement is smallest safe boundary. Cross-user real-Appwrite tests are
mandatory defense against missing predicates.

**Alternatives considered**:

- Browser TablesDB access with row permissions: rejected because rows contain internal fields
  not permitted in user surfaces and domain invariants could be bypassed.
- Trusting JWT claims without Account validation: rejected; auth failure must fail closed.
- Shared/global rows: rejected; violates owner isolation.

**Sources**: [Appwrite SSR authentication](https://appwrite.io/docs/products/auth/server-side-rendering),
[database permissions](https://appwrite.io/docs/products/databases/permissions),
[API-key bypass behavior](https://appwrite.io/docs/advanced/security/permissions).

## R-02: Appwrite TablesDB fit and limits

**Decision**: Pin Appwrite `1.9.6`, image digest, response format, and its official default
MongoDB adapter in Compose. Only Appwrite owns/uses that adapter; Cashmemo has no MongoDB driver,
credential, query, dump, or connection. Use TablesDB REST/GraphQL APIs only. Keep each domain transaction below ten
operations, each table below twenty custom indexes, list `ttl=0`, page size at most 200, and
application query count below Appwrite limits.

**Rationale**: Current supported capabilities fit typed columns, `bigint`, compound unique/key
indexes, nested AND/OR comparisons, multiple order clauses, transactions, and physical row
deletion. Current constraints important to this design:

- IDs are at most 36 characters.
- `varchar` is at most 16,383 characters and fully indexable only below 768 characters.
- List requests allow at most 100 query strings of 4,096 characters each.
- Mongo adapter exposes at most 64 indexes/table and 1,024 index length.
- Appwrite 1.9.6 rejects indexes on array columns; indexed n-gram arrays are unavailable.
- Default self-host transaction cap is 100 operations; transaction lifetime is bounded.
- Row writes do not invalidate cached list responses, so money data uses `ttl=0`.

Appwrite distribution may use internal Redis/cache/queue services. That vendor-owned dependency
does not become Cashmemo domain/server state and does not justify a separate application Redis.

**Alternatives considered**:

- Direct MongoDB queries/indexes: forbidden and unsupported.
- Floating-point amount column: rejected for exact money.
- Appwrite “latest” image: rejected; schema/query behavior must be reproducible.

**Sources**: [Appwrite 1.9.6 installation](https://appwrite.io/docs/advanced/self-hosting/installation),
[TablesDB reference](https://appwrite.io/docs/references/cloud/server-rest/tablesDB),
[table types and indexes](https://appwrite.io/docs/products/databases/tables),
[transactions](https://appwrite.io/docs/products/databases/transactions),
[queries](https://appwrite.io/docs/products/databases/queries),
[Appwrite 1.9.6 constants](https://github.com/appwrite/appwrite/blob/1.9.6/app/init/constants.php),
[Mongo adapter limits](https://github.com/utopia-php/database/blob/fff9f0effbd40359ff925741ff9424856d8b4fde/src/Database/Adapter/Mongo.php).

## R-03: Case-insensitive label uniqueness

**Decision**: One labels table holds Category and Money Space rows. Rust computes
`name_key = NFKC(full_case_fold(trim(name)))`. Unique index
`(owner_id, kind, name_key)` excludes `active`, so active and deactivated names collide.
Constraint race maps to `LABEL_NAME_CONFLICT`; matching deactivated label is returned as
reactivation option.

**Rationale**: Appwrite unique indexes enforce stored bytes but expose no portable expression
index or guaranteed Unicode case-fold collation. Application normalization plus database unique
constraint covers semantic equality and concurrency. Diacritics remain significant because
spec requires case-insensitive, not diacritic-insensitive, label names.

**Alternatives considered**:

- Preflight lookup only: rejected; concurrent creates can race.
- Unique index including active status: rejected; would allow active/deactivated duplicates.
- Lowercase only: rejected; not full Unicode case folding.

## R-04: Durable creation fingerprint and retry

**Decision**: Browser generates UUIDv4 once per compose session and stores it in Dexie with
draft. Server validates input, produces deterministic canonical payload, generates random
256-bit per-memo MAC key, calculates HMAC-SHA-256 with domain separation, and AEAD-wraps MAC key
under versioned runtime KEK. Store immutable fingerprint and wrapped-key metadata. Unique
`(owner_id, creation_id)` index provides durable claim.

Canonical input includes authenticated owner, creation ID, exact amount minor integer/scale,
currency, occurrence instant/wall/offset, label IDs, exact accepted note or null, type, planned
status, and purpose. It excludes lifecycle, revision, and later edits. Compare MAC in constant
time.

Matching retry returns current resource/lifecycle/revision and performs zero writes. Mismatch
returns `CREATION_IDENTIFIER_CONFLICT`. Concurrent unique loser fetches winner and takes same
comparison path. Missing/unwrappable key returns
`IDEMPOTENCY_VERIFICATION_UNAVAILABLE`; it never compares live fields or creates duplicate.

KEK rotation rewraps per-memo keys without changing fingerprint, revision, or domain update
time. Prior KEK remains in escrow until rewrap coverage and every backup holding old wrapping
expires. Compromise triggers immediate rotation and incident response; rotation cannot erase
risk from already stolen database-plus-key material.

**Rationale**: Plain digest permits offline confirmation over small amount/currency/date
spaces. Per-memo random key keeps immutable fingerprint while allowing KEK rotation.

**Alternatives considered**:

- SHA-256 or unkeyed canonical hash: rejected; offline guessing succeeds.
- One permanent global HMAC key: rejected; retirement impossible while any memo remains.
- Compare retry with live row: rejected; edits would break legitimate retry.
- Store original plaintext request: rejected; duplicates sensitive content.
- Deterministic memo ID from creation ID: rejected; post-purge reuse could collide with old
  suppression token.

**Sources**: [HMAC, RFC 2104](https://www.rfc-editor.org/rfc/rfc2104),
[JSON Canonicalization Scheme, RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html),
[UUID, RFC 9562](https://www.rfc-editor.org/rfc/rfc9562),
[NIST key-management guidance](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final).

## R-05: Optimistic concurrency and atomic mutations

**Decision**: Every mutable user entity carries explicit caller-visible revision. Mutation
starts Appwrite transaction, reads row with transaction ID, verifies owner/lifecycle/expected
revision, stages whole update with revision + 1 and required related operations, then commits.
Appwrite commit conflict is refetched and mapped to stable `REVISION_CONFLICT` with current
resource. No merge or partial application occurs.

User journal-state row is touched by every export-visible mutation, coordinating result-set
generation dimensions and export fence. Base membership/order generation changes on create,
archive, restore, deletion request, purge, and occurrence edit. Search/filter dimension generations
change only when their participating field changes. Label reference counts change in same
transaction as memo create/reference edit/purge. Label deletion requires zero count inside
transaction.

**Rationale**: TablesDB update has no caller `If-Match`/revision predicate. Appwrite transaction
detects affected-row conflict and supplies atomic multi-row commit; explicit domain revision
provides contract users need.

**Alternatives considered**:

- `$updatedAt` comparison: rejected; not caller-enforced and hard to test with controlled clock.
- Last-write-wins: rejected; silent lost edits.
- Check then non-transactional patch: rejected; TOCTOU race.

## R-06: Time representation

**Decision**: Persist `occurrence_instant_us` signed bigint, `occurrence_local_wall` fixed
microsecond string, `occurrence_local_date` ISO date, and `occurrence_offset_minutes`. Persist
domain `created_at_us`/`updated_at_us` bigints from injected clock. Validate
`local wall - offset = instant`.

Boundary serialization is canonical UTC `YYYY-MM-DDTHH:mm:ss.SSSSSSZ` with exactly six fractional
digits. Offset parser accepts `-13:59..+13:59` plus exact `-14:00` and `+14:00`; any 14-hour value
with nonzero minutes is invalid. `MoneyMemo.purgeDeadline` is always present: null for
active/archived and canonical non-null UTC for pending deletion.

Sort uses instant. Date range uses inclusive stored local dates. Ordinary date/time edit keeps
offset. Explicit offset change keeps wall time. Recorded-zone display uses stored wall/offset;
viewer-zone toggle derives from instant and changes neither storage nor filters. DST overlap
requires explicit valid offset selection; DST gap is rejected.

**Rationale**: UTC-only loses lived local date; wall-only loses total order; zone-name
re-resolution can change after timezone database updates. Appwrite `bigint` gives deterministic
microsecond comparison while its datetime precision is not sufficiently specified for tie
ordering.

**Alternatives considered**: UTC-only, local-only, and silently recapturing device offset are
all rejected by specification.

**Sources**: [Appwrite `bigint`](https://appwrite.io/docs/products/databases/tables),
[RFC 3339](https://www.rfc-editor.org/rfc/rfc3339.html),
[Temporal timezone model](https://tc39.es/proposal-temporal/docs/timezone.html).

## R-07: Deterministic keyset pagination

**Decision**: External cursor is `v1.kid.nonce.AEAD-ciphertext`, 30-minute maximum TTL. Payload
binds owner, view, canonical query/filter digest, page size, result-set version, issued/expiry, and
last tuple `(occurrence_instant_us, created_at_us, memo_id)`. Every page exposes the same opaque
result-set version, and every continuation supplies it as `expectedResultSetVersion`; request,
cursor, and recomputed current version must match. Encryption prevents cursor holder from learning
search/date/owner values.

Result-set version is a keyed opaque digest over owner, normalized view/query digest, base
membership/order generation, and only generation dimensions used by that query. Base generation
changes on create, archive, restore, deletion request, purge, and occurrence edit. Note-search and
each filter dimension generation change when that participating field changes. This makes an edit
that changes current-query membership invalidate that query while a non-sort-key edit irrelevant
to current-query membership preserves its traversal.

Recently Deleted cursor/version additionally bind `membershipValidUntil`, the earliest pending
purge deadline in that view. Continuation at or after it returns `LIST_CHANGED` before row mapping,
so logical expiry invalidates traversal without scheduler participation and no expired row is
returned for cursor history.

Continuation query for descending order is:

```text
occurrence < C1
OR (occurrence = C1 AND created < C2)
OR (occurrence = C1 AND created = C2 AND memo_id < C3)
```

Mandatory owner/lifecycle/filter predicates are ANDed. Appwrite applies same three descending
orders. Cursor invalid/tampered/wrong owner/query/view returns `PAGE_POSITION_INVALID`; expired
returns `PAGE_POSITION_EXPIRED`.

Do not use Appwrite `cursorAfter(rowId)`: it first depends on cursor row, which purge can remove.
Do not claim snapshot. Recompute result-set version before and after every page query; any request,
cursor, or current-version mismatch discards the page and returns `LIST_CHANGED` with mandatory
refresh. Complete exactly-once traversal is guaranteed only while membership and ordering remain
unchanged. Purged and expired rows are never returned to honor cursor history.

**Rationale**: Keyset predicate avoids a row-anchor dependency and preserves total order. Opaque
query-relevant generation digest detects every membership/order change without invalidating a
traversal for an unrelated membership-neutral non-sort edit.

**Alternatives considered**:

- Offset pagination: rejected for concurrent changes and performance.
- Appwrite row cursor: rejected because anchor purge invalidates it.
- Full membership snapshot: rejected by approved spec and incompatible with immediate purge.

**Sources**: [Appwrite pagination](https://appwrite.io/docs/products/databases/pagination),
[ordering](https://appwrite.io/docs/products/databases/order),
[logical/comparison queries](https://appwrite.io/docs/products/databases/queries).

## R-08: Search behavior and privacy

**Decision**: Rust stores derived `note_search = strip_combining_marks(NFKD(full_case_fold(note)))`
in same memo row. It normalizes each trimmed search term, enforces two-character minimum, emits
one substring `contains` predicate per term (AND), and verifies normalized substring after read.
Only note contributes; label names never do. Pending/expired rows are filtered before mapping.

Public search is POST body. Rust-to-Appwrite uses supported GraphQL POST for raw search variables
or a private REST hop whose URL query logging is proven disabled; GraphQL POST is preferred.
Request bodies, generated Appwrite queries, SDK error bodies, and URLs with query values are
never instrumented. Appwrite/OpenObserve/container logs receive real canary leak scan.

**Rationale**: Native `Query.search` is keyword/full-text, minimum three characters, and has stop
character behavior; it cannot meet two-character case/diacritic-insensitive substring semantics.
`contains` matches substring. Normalized shadow provides deterministic semantics. Current
Mongo-backed contains may not use index, so real p95 under 10,000 rows is a release gate.

**Alternatives considered**:

- Native full-text search: rejected; wrong contract.
- Indexed n-gram array: rejected because Appwrite 1.9.6 refuses array-column index.
- External search service: rejected as unnecessary infrastructure before benchmark proves need.
- Loading all 10,000 notes into browser: rejected for privacy and performance.

**Sources**: [Appwrite query operators](https://appwrite.io/docs/products/databases/queries),
[GraphQL TablesDB](https://appwrite.io/docs/references/cloud/server-graphql/tablesDB).

## R-09: Lifecycle and scheduled physical purge

**Decision**: Persist only `active`, `archived`, `pending_deletion`. Expired is derived at
`now >= purge_deadline`; purged has no row. Every read path checks deadline before mapping.
Immediate purge first sets deadline to now transactionally, preventing concurrent restore.

Purge flow:

1. Verify derived expiry or second immediate-purge confirmation.
2. Determine `removal_not_before_at` from complete/in-progress backup inventory.
3. Durably and idempotently write keyed suppression token outside Appwrite rollback unit.
4. Delete memo/search support and decrement label counts in Appwrite transaction.
5. Treat duplicate token, absent row, and retry conflict idempotently.

If token write fails, record remains physically present but inaccessible; alert and retry. If
Appwrite delete fails after token, same. Access path performs best-effort same purge then returns
indistinguishable not-found.

Hourly Dokploy scheduled command `cashmemo purge-expired --batch-size 200` uses same application
and domain modules. Every run selects all expired rows from durable state; no missed-run cursor is
required. First successful run after recovery therefore resumes automatically and idempotently.
Batches order by deadline then ID. Concurrent runs are safe. No app Redis.

The 24-hour target is an operational SLO, not an unconditional physical guarantee during total
outage. “Normal service availability” means at least one executor can start an hourly run and both
Appwrite TablesDB and suppression storage accept required supported operations throughout the
deadline-to-deletion interval. Exact logical inaccessibility never pauses. Aggregate monitoring
emits scheduler-heartbeat age, oldest-overdue age, attempt/delete/failure counts, and run ID only.
Warn at 12 hours, page before 24 hours, and alert every record cohort breaching 24 hours without
including memo, owner, or token identifiers. Evidence must show outage detection, automatic
recovery run, idempotent retry, overdue discovery, and backlog clearance.

**Rationale**: Appwrite has physical delete but no feature-specific trash/TTL/scheduler. Durable
token-before-delete is only safe cross-system order because external object write and Appwrite
transaction cannot be atomic.

**Alternatives considered**:

- Access-only cleanup: rejected; untouched rows persist indefinitely.
- Appwrite Function/microservice: rejected; duplicate implementation/deployment.
- TTL index: unsupported and cannot coordinate suppression.

## R-10: Suppression ledger and backup retention

**Decision**: Canonical ledger lives in encrypted S3-compatible backup-control bucket outside
Appwrite backup rollback unit. Object key is `deletion_token`, a versioned, truncated 192-bit HMAC
of raw memo ID under dedicated purge key; it is keyed, non-reversible, and carries no owner or memo
metadata. Payload contains only `purged_at` and `removal_not_before_at`. Together, entry has exactly
`deletion_token`, `purged_at`, and `removal_not_before_at`; no raw memo ID, owner, financial field,
reason, fingerprint, or other metadata.

Maximum backup retention is exactly 30 days from capture. Every full/manual/provider/temporary
copy is inventoried with capture and `destruction_deadline_at`. `removal_not_before_at` equals the
maximum registered destruction deadline among complete or in-progress backups that can contain
memo; when that set is empty it equals `purged_at`. It is not merely “purged + 30 days” and is
earliest cleanup eligibility, never automatic expiry.
Backup and purge coordinators serialize manifest registration/capture boundary so no containing
backup is missing from inventory.

After eligibility, cleanup must verify destruction of every primary, replica, noncurrent version,
multipart fragment, temporary copy, and drill copy capable of resurrection. Only verified closure
permits conditional token deletion and verification that all token object versions are absent.
Failed or unverifiable destruction retains token, alerts Platform and Security, retries inventory
verification, and blocks cleanup and affected restore cutover. Suppression-token prefixes have no
TTL or provider lifecycle expiration; lifecycle rules may assist backup artifact destruction but
never delete suppression tokens. Purge keys remain until every token under the key passes this
verified cleanup gate.

**Rationale**: A ledger stored only in Appwrite would roll back with older backup and forget
later deletion. Independent control plane is necessary to prove non-resurrection.

**Alternatives considered**:

- Raw memo ID ledger: rejected; keyed non-reversible token is narrower.
- Appwrite-only ledger: rejected; restore erases later entries.
- Permanent ledger: rejected; purpose ends with last containing backup.

**Sources**: [Appwrite self-host backup guidance](https://appwrite.io/docs/advanced/self-hosting/production/backups),
[Dokploy volume backups](https://docs.dokploy.com/docs/core/volume-backups),
[Dokploy scheduled jobs](https://docs.dokploy.com/docs/core/schedule-jobs).

## R-11: Backup and restore method

**Decision**: Use quiesced opaque named-volume/provider system snapshots of full Appwrite stack,
not `mongodump` or Mongo queries. Maintenance coordinator registers manifest and expiry, stops
all Appwrite writers, captures all required volumes/config, then restarts. Restore always targets
fresh, isolated exact-version installation.

Before routing, `cashmemo restore-reconcile` loads independent ledger/keyring, enumerates every
restored memo via supported TablesDB APIs, recomputes possible token under retained keys, deletes
matches, purges expired pending-deletion rows, runs second full scan and integrity/privacy tests,
then permits cutover. Missing ledger/key, incomplete enumeration, delete failure, or assertion
failure blocks cutover.

**Rationale**: Official Appwrite guide requires self-host operators to manage backups and fresh
restore targets. Its logical Mongo path conflicts with explicit no-internal-Mongo rule. Opaque
quiesced snapshot preserves that boundary.

**Alternatives considered**:

- `mongodump`/`mongorestore`: explicitly forbidden by architecture.
- In-place restore: Appwrite warns fresh installation only and mixes states.
- Serve then reconcile: rejected; purged memo could become reachable.

## R-12: Accepted-instant export

**Decision**: Version 1 export is complete UTF-8 RFC 8259 JSON validated against
`contracts/export-v1.schema.json`. Exact acceptance instant is successful commit of per-user
export lease. All memo and label mutations transact against same user-state row and return
retryable `EXPORT_IN_PROGRESS` while lease active.

Export reads all eligible rows/references with owner predicates, `ttl=0`, and internal keyset
pages; builds full file in bounded private memory; validates schema, reference integrity, lease
ownership/deadline; releases fence; then sends bytes. On any failure, sends no file. Lease expiry
recovers crash. No write can commit after acceptance and before snapshot build finishes.

**Rationale**: Appwrite transactions are atomic and conflicting, but documentation does not
promise multi-page snapshot/repeatable-read isolation. Write fence creates actual linearization
point without inventing snapshot claim.

**Alternatives considered**:

- Appwrite transaction reads across pages: rejected; undocumented isolation.
- Before/after version retry: rejected; retry snapshot would be later than accepted instant.
- MVCC history: rejected; retains old sensitive versions and complicates purge.
- CSV: rejected; wrong schema/consistency/internal-field controls.

## R-13: Exact export contract

**Decision**: MIME `application/vnd.cashmemo.money-memo-export+json;version=1`; filename
`cashmemo-export-<acceptedAt>.json`; JSON Schema 2020-12 with `additionalProperties: false`.
Amount is decimal string plus currency and scale. Occurrence contains instant, wall time, and
offset. References are top-level Category/Money Space arrays by stable ID/name. Memos retain
reference IDs, lifecycle, user fields, creation/update instants. Recently Deleted never enters
serialization. Internal security, revision, owner, cursor, export-fence, deletion, purge, and
suppression fields are absent.

Decimal has exactly `minorUnitScale` fractional digits: scale 0 has no decimal point and scales
1–4 have exactly that many digits. JSON Schema conditional branches are generated or verified from
the authoritative currency contract; too few/many digits fail. All instants use canonical
six-digit UTC `Z`, and occurrence offset accepts exact ±14:00 but no 14-hour value with nonzero
minutes.

**Rationale**: Versioned JSON is broadly machine-readable and lossless. Top-level references
preserve identity without duplicating mutable names per memo.

## R-14: PWA and browser durability

**Decision**: Service worker precaches versioned static shell/assets only. All API routes are
network-only with `Cache-Control: no-store`; no server-state persistence, replay queue, or
offline ledger exists. Zustand owns current form/UI only. Dexie owns recoverable create/edit
draft plus stable creation ID/retry status until success or explicit discard.

**Rationale**: Meets PWA capability and failed-write recovery without implementing general
offline sync. TanStack Query remains sole server-state cache.

**Alternatives considered**:

- Persist TanStack Query cache: rejected; becomes offline data/sync surface.
- Generic background sync queue: rejected; out of feature scope.
- Zustand persistence: rejected; durable state belongs in Dexie adapter.

## R-15: Privacy-safe observability

**Decision**: Emit allowlisted route template, method, status, stable error/operation code,
duration, retry count, trace/request/run IDs, service version, and aggregate count buckets.
Never emit raw URL/query, headers/cookies/JWT, body, Appwrite query/payload/error body, record or
owner ID, amount, currency/date, note, label name, search text, cursor, fingerprint/wrapped key,
purge token, or export bytes.

Controls exist at HTTP extraction, domain redacted `Debug`, persistence adapter, frontend crash
handler, OTel instrumentation, Collector allowlist/redaction, and OpenObserve ingestion. Search
and export spans use explicit safe fields only. Collector is defense in depth; source boundaries
must already be clean.

**Rationale**: Record IDs in telemetry would survive record purge and complicate exhaustive
deletion proof. Request/trace ID provides diagnosis without durable resource linkage.

**Sources**: [OTel URL privacy warning](https://opentelemetry.io/docs/specs/semconv/url/),
[handling sensitive telemetry](https://opentelemetry.io/docs/security/handling-sensitive-data/),
[OpenTelemetry security](https://opentelemetry.io/docs/security/).

## R-16: Test evidence and human/operational owners

**Decision**: Domain uses injected controllable clock; Tokio scheduler tests use paused time.
Real Appwrite closes permissions, uniqueness, transactions, cursor query, search, cache, purge,
and export-fence requirements. Real isolated restore automation runs 100 cycles pre-release and
after material backup/Appwrite/purge changes; Platform owns quarterly real drill, Security signs
reconciliation. Product Research owns 20-user synthetic-data study; QA owns instrumentation;
Privacy reviews capture.

Security and QA jointly own Pattern Set versioning, labeled false-result report, and diagnostic
isolation evidence every release and detector/copy change. Platform and QA own scheduler
outage/recovery and overdue-alert drill before launch, every release, and quarterly; evidence must
show stale heartbeat, SLO breach, automatic idempotent recovery, and zero remaining overdue rows.

Cryptographic tests cover construction, canonical vectors, constant-time comparison, key
separation/rotation/failure, and dictionary attack against fingerprint without key. They do not
claim exhaustive proof of cryptographic security.

**Rationale**: Clock control avoids real 30-day waits. Constitution forbids mock-only evidence
for real integrations. SC-001/002/014 and real restore cannot be replaced by unit tests.

## R-17: Sensitive free-text boundary and exact Pattern Set v1

**Decision**: Cashmemo never requests, encourages, infers, or models bank credentials, account or
routing numbers, card details, verification codes, banking tokens, bank statements, or government
identifiers. Memo note, Category name, and Money Space name show a clear adjacent warning. Search
shows the same warning in privacy help. Detector is deterministic and best-effort; no AI, semantic
classifier, external API, analytics pipeline, or retained detector corpus is used.

Pattern Set v1 applies client-side before transmission and independently at server trust boundary.
Preprocessing uses an ephemeral buffer: normalize CRLF to LF, Unicode NFKC, map Unicode decimal
digits to ASCII, and ASCII-case-fold detector keywords. Original input stays byte-exact in local
compose/search state. Candidate separators are ASCII space, tab, or hyphen. “Same line” means text
between adjacent LF characters. “After label” means first non-space candidate beginning no more
than 32 Unicode scalar values after the label ends.

### Blocking-class detectors

| ID | Exact match condition |
|---|---|
| `B1_PAN_LUHN` | A maximal candidate containing 13–19 digits after removing candidate separators, bounded by non-digits, and passing Luhn checksum. |
| `B2_IBAN_MOD97` | A maximal candidate beginning with two ASCII letters and two digits, containing 15–34 uppercase alphanumeric characters after separator removal, and satisfying ISO 13616 rearrangement with remainder 1 modulo 97. |
| `B3_LABELED_ACCOUNT` | Same-line label from `account number`, `account no`, `account #`, `acct number`, `acct no`, `a/c no`, `nomor rekening`, `no rekening`, `no. rekening`, followed by 6–34 alphanumeric characters after separator removal. |
| `B4_LABELED_ROUTING` | Same-line label `routing number`, `routing no`, or `ABA` followed by nine digits passing ABA checksum `(3(d1+d4+d7)+7(d2+d5+d8)+(d3+d6+d9)) mod 10 = 0`; or label `sort code`/`BSB` followed by exactly six digits. |
| `B5_LABELED_CARD_SECRET` | Same-line label `CVV`, `CVC`, `CID`, `card verification code`, `card security code`, or `kode keamanan kartu` followed by exactly 3–4 digits. |
| `B6_LABELED_BANK_CREDENTIAL` | Same-line label `bank password`, `banking password`, `online banking password`, `internet banking password`, `bank PIN`, `ATM PIN`, `mobile banking PIN`, `m-banking PIN`, `password bank`, or `PIN bank` followed by `:` or `=` optionally and then one non-whitespace token of 4–128 characters. |
| `B7_LABELED_BANK_TOKEN` | Same-line label `bank access token`, `banking access token`, `bank refresh token`, `banking token`, `mobile banking token`, `internet banking token`, `bank OTP`, `banking OTP`, or `bank TAC` followed by `:` or `=` optionally and then 6–512 characters from ASCII letters, digits, `.`, `_`, `~`, `+`, `/`, `-`, or `=`. |
| `B8_STATEMENT_PASTE` | One of `bank statement`, `account statement`, `rekening koran`, `mutasi rekening`; at least two distinct markers from `account number`/`nomor rekening`, `statement period`/`periode`, `opening balance`/`saldo awal`, `closing balance`/`saldo akhir`, `transaction date`/`tanggal transaksi`, `debit`, `credit`; and at least three later lines each containing a date token (`YYYY-MM-DD`, `DD/MM/YYYY`, or `DD-MM-YYYY`) plus a digit amount token. |
| `B9_LABELED_GOV_ID` | Same-line label `SSN`/`social security number` plus `DDD-DD-DDDD`; `NIK`/`nomor induk kependudukan` plus exactly 16 digits; or `government ID`, `national ID`, `identity number` plus 6–24 alphanumeric characters after separator removal. |

Blocking match prevents submission. Client sends no blocked value. Bypass request is rejected by
server as HTTP 422 with stable `PRIVACY_INPUT_REJECTED`, field name, detector-set version, and
correction guidance. Response may include only the published safe B1–B9 detector identifier; it
never echoes candidate content, matched value, normalized buffer/output, hash, match offset, or
substring. Detector identifiers never enter logs, traces, metrics, analytics, crash reports, or
evidence; no candidate content or detector derivative is persisted or emitted.

### Warning-class detectors

| ID | Exact match condition |
|---|---|
| `W1_BANKING_CONTEXT` | Any phrase `bank account`, `card number`, `bank statement`, `bank token`, `bank password`, `rekening`, `kartu kredit`, or `kartu debit` not already caught by blocking detector. |
| `W2_UNLABELED_LONG_NUMBER` | A maximal 6–34 digit candidate, allowing candidate separators, not caught by `B1`–`B5` or `B9`. |
| `W3_STATEMENT_HEADER` | Any `B8` statement header without enough markers/transaction rows to satisfy `B8`. |

Warning initially keeps text local and offers edit, remove, or continue with unchanged text. Continue
creates no persisted or transmitted attestation. Server reruns Pattern Set v1: blocking-class text
is always rejected, while warning-only text may proceed because warning patterns are intentionally
ambiguous. Search warning preserves local search input and offers clear or continue. This behavior
prevents false-positive warnings from becoming hidden absolute blocks while preserving correction
path and honest detector limits.

When detector warns or blocks, only synchronous in-memory pattern evaluation may inspect content.
No further analysis, inference, logging, tracing, metrics, analytics, crash reporting, remote
configuration, or evidence capture receives candidate content or derivatives. Crash handlers must
drop detector state before capture.

**Known false positives**: Luhn-valid order/gift-card/tracking numbers; long phone/reference
numbers; legitimate discussion of banking phrases; innocuous examples in teaching text; `NIK` or
`PIN` used with another meaning. Warnings and local attestation provide correction path for
ambiguous cases. Blocking false positives require editing or omitting value; release evidence
reports each detector's labeled-corpus count.

**Known false negatives**: unlisted languages/labels, bank names alone, account formats without a
listed label, obfuscated or spelled-out digits, OCR errors, novel token formats, statement formats
outside `B8`, national identifiers outside `B9`, and any semantic banking content not matching
declared syntax. Tests prove only declared construction and fixtures. Product copy and evidence
must never claim universal or complete detection.

**Alternatives rejected**:

- Reject all free text: destroys core Money Memo value and still does not classify meaning.
- AI/semantic classifier: out of scope, adds prohibited inference and disclosure path.
- Store then scrub: violates trust-boundary and diagnostic constraints.
- Hash match candidates: creates durable confirmation material and still leaks pattern behavior.

## R-18: Authoritative reconciliation before tasks

Sensitive-content wording is specification correction plus constitution exception C-07.
Constitution v1.0.0 literally prohibits accepting, transmitting, or storing any prohibited value
and forbids reinterpretation; finite arbitrary-text detection can miss one. C-07 therefore records
rationale, accepted risks, controls, Product/Security ownership, annual/material-change review, and
removal through constitution amendment or removal of arbitrary free text. Constitution prohibition
still governs product solicitation, dedicated fields, detected content, storage intent, diagnostics,
and incident handling.

Physical deletion wording is also specification correction, not constitution exception.
Constitution requires explicit, tested deletion/retention behavior but sets no outage-independent
24-hour physical bound. FR-060 remains unconditional; FR-061/SC-020 now define operational SLO,
automatic idempotent recovery, alerts, and evidence.

Pagination has no unresolved contradiction. Specification selects result-set-version-guarded live
keyset traversal, not snapshot membership. Exactly-once completion holds only for unchanged
membership/order; enumerated mutations and query-membership changes require refresh, and immediate
purge/expiry exclusion always wins.
No remaining specification contradiction blocks task generation. C-07 remains explicit governance
state, not a hidden claim of full compliance.
