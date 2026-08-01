# Data Model: Money Memo Foundation

## Modeling rules

- Domain types below are authoritative. Appwrite adapter maps them to TablesDB columns without
  leaking Appwrite models into domain.
- All IDs are lowercase canonical UUID strings, maximum 36 characters. They are opaque and
  never derived from creation ID.
- All exact instants are signed epoch microseconds in `bigint`. API/export map to RFC 3339 UTC
  with six fractional digits.
- Money never uses float. `amount_minor` is signed-64-safe positive integer; `amount_scale` is
  currency minor-unit scale; direction is `income`/`expense`.
- TablesDB is backend-private. Every domain query/mutation supplies authenticated owner.
- `created_at_us`, `updated_at_us`, revisions, lifecycle, fingerprints, derived search, and
  deletion fields cannot be client-set through edit contract.

## Money Memo

TablesDB table: `money_memos`

| Field | Storage | Rules / purpose |
|---|---|---|
| `$id` | Appwrite row ID | Random UUID; same as `memo_id` for direct mapping |
| `memo_id` | varchar(36), required | Public stable opaque identifier; explicit sortable/indexable copy |
| `owner_id` | varchar(36), required | Derived from Appwrite account, never request body |
| `memo_type` | enum | `income`, `expense` |
| `amount_minor` | bigint | `> 0`; exact amount at `amount_scale`; maximum major amount 999,999,999,999 |
| `amount_scale` | integer | Registry scale for `currency`; 0–4 supported by v1 registry |
| `currency` | varchar(3) | Uppercase code in pinned `iso4217-list-one-2026-01-01` registry |
| `occurrence_instant_us` | bigint | Exact UTC instant used for global ordering |
| `occurrence_local_wall` | varchar(26) | Fixed `YYYY-MM-DDTHH:mm:ss.SSSSSS`, no offset |
| `occurrence_local_date` | varchar(10) | Derived `YYYY-MM-DD`, used for deterministic date filters |
| `occurrence_offset_minutes` | integer | Captured UTC offset; `-840..840` |
| `category_id` | varchar(36) | References same-owner active/deactivated Category |
| `money_space_id` | varchar(36) | References same-owner active/deactivated Money Space |
| `note` | varchar(1000), nullable | Exact accepted note; empty/omitted becomes null |
| `note_search` | text, nullable | Derived case/diacritic-folded note for substring search; never exposed |
| `planned_status` | enum | `planned`, `unplanned` |
| `purpose` | enum | `personal`, `work`, `mixed` |
| `lifecycle_status` | enum | Exactly `active`, `archived`, `pending_deletion` |
| `pre_delete_status` | enum, nullable | `active`/`archived` only while pending deletion; restore target |
| `deletion_requested_at_us` | bigint, nullable | First accepted deletion instant; never reset |
| `purge_deadline_us` | bigint, nullable | Null active/archived; required pending deletion; first request + 30 days; immediate purge sets current clock |
| `revision` | bigint | Starts 1; increments every user-visible successful mutation |
| `creation_id` | varchar(36) | UUIDv4 supplied by compose session, durable until purge |
| `creation_fingerprint` | varchar(64) | Immutable encoded HMAC-SHA-256 |
| `fingerprint_key_ciphertext` | varchar | AEAD-wrapped per-memo MAC key; internal security metadata |
| `fingerprint_key_nonce` | varchar | AEAD nonce; internal security metadata |
| `fingerprint_kek_id` | varchar(16) | Runtime KEK version; internal security metadata |
| `created_at_us` | bigint | Injected server clock; immutable |
| `updated_at_us` | bigint | Injected server clock; changes on user-visible mutation only |

### Money validation

1. API accepts canonical decimal string only: ASCII digits with optional `.` fractional part.
   No sign, grouping separator, exponent, or comma. UI may localize display but sends canonical
   form. `1,500` is rejected, never reinterpreted.
2. Fraction length must not exceed registry scale; no rounding. Server converts to minor integer
   exactly and renders API/export decimals with exactly that scale. Scale 0 has no decimal point;
   scales 1–4 have exactly 1–4 fractional digits. Too few or too many digits are invalid in
   serialized output.
3. Maximum uses major value before scale. Exact maximum accepted; one minor unit over rejected.
4. Currency registry v1 is immutable for this feature and sourced from SIX ISO 4217 List One
   effective 2026-01-01, excluding rows whose minor unit is `N.A.`. Existing memos retain stored
   scale if registry later changes; registry update requires versioned migration decision.

### Occurrence validation

1. Parse local wall and integer offset; verify `wall - offset == instant`.
   Offset range is `-13:59..+13:59` plus exact `-14:00` and `+14:00`; 14-hour offsets with
   nonzero minutes are invalid. API/export instants serialize only as canonical UTC
   `YYYY-MM-DDTHH:mm:ss.SSSSSSZ`.
2. Local date must be within ten calendar years inclusive of current date evaluated in submitted
   offset.
3. Normal date/time edit accepts wall only and reuses existing offset.
4. Offset-change command accepts wall + new offset and explicit confirmation; wall stays equal.
5. Ambiguous local time requires one valid offset choice. Nonexistent local time is rejected.
6. API `MoneyMemo.purgeDeadline` is required nullable: null for `active`/`archived`, canonical
   non-null UTC for `pending_deletion`.

### Creation fingerprint canonical document

```json
{
  "v": 1,
  "ownerId": "authenticated Appwrite owner",
  "creationId": "canonical UUIDv4",
  "type": "expense",
  "amount": { "minor": "4250", "scale": 2 },
  "currency": "USD",
  "occurrence": {
    "instant": "2026-07-30T12:15:00.000000Z",
    "localWallTime": "2026-07-30T19:15:00.000000",
    "offsetMinutes": 420
  },
  "categoryId": "...",
  "moneySpaceId": "...",
  "note": null,
  "plannedStatus": "unplanned",
  "purpose": "personal"
}
```

Domain separator: `cashmemo.creation-fingerprint.v1\0`. Values are validated/canonical before
encoding. Field order/number/string form follows canonical JSON. Note preserves accepted Unicode
scalar sequence; only omitted/empty normalize to null. Fingerprint and wrapped-key fields never
enter DTO, export, cursor, error, telemetry, or suppression ledger.

## Label

TablesDB table: `labels`. Domain exposes Category and Money Space as separate typed resources.

| Field | Storage | Rules / purpose |
|---|---|---|
| `$id` / `label_id` | UUID varchar(36) | Stable opaque reference |
| `owner_id` | varchar(36) | Authenticated owner |
| `kind` | enum | `category`, `money_space` |
| `name` | varchar(100) | Trimmed display name; non-empty |
| `name_key` | varchar(256) | `NFKC(full_case_fold(trim(name)))`; internal unique key |
| `state` | enum | `active`, `deactivated` |
| `memo_reference_count` | bigint | All active/archived/pending memo references; cannot be client-set |
| `revision` | bigint | Starts 1; caller-visible stale-write protection |
| `created_at_us` | bigint | Server clock, immutable |
| `updated_at_us` | bigint | Server clock; user-visible label changes only |

Rename changes `name`/`name_key` on same row, so all memo displays change without memo rewrite.
Deactivation leaves references and filter availability intact but excludes from new selections.
Reference count changes only with memo create, reference edit, and physical purge. Permanent
label deletion requires explicit confirmation and count zero in same transaction.

## User Journal State

TablesDB table: `user_journal_state`; one row per Appwrite owner. Backend-only coordination row.

| Field | Storage | Rules / purpose |
|---|---|---|
| `$id` | varchar(36) | Opaque deterministic state-row ID; not exposed |
| `owner_id` | varchar(36), unique | Authenticated owner |
| `mutation_generation` | bigint | Increment every export-visible memo/label mutation |
| `base_result_generation` | bigint | Increment create/archive/restore/delete/purge/occurrence edit |
| `note_search_generation` | bigint | Increment note-search projection change |
| `type_generation` | bigint | Increment memo type change |
| `currency_generation` | bigint | Increment currency change |
| `category_generation` | bigint | Increment Category reference change |
| `money_space_generation` | bigint | Increment Money Space reference change |
| `planned_status_generation` | bigint | Increment planned-status change |
| `purpose_generation` | bigint | Increment purpose change |
| `next_pending_deadline_us` | bigint, nullable | Earliest pending deadline; Recently Deleted traversal validity bound |
| `export_lease_id` | varchar(36), nullable | Random current export lease |
| `export_accepted_at_us` | bigint, nullable | Exact fence linearization instant |
| `export_lease_deadline_us` | bigint, nullable | Crash recovery deadline; bounded clock skew monitored |

Every export-visible mutation reads/touches this row in same Appwrite transaction. Active export
lease blocks mutation with retryable error. Expired lease may be stolen transactionally.
Generation-only internal updates never alter Money Memo revision/timestamps. Result-set version is
an opaque keyed digest over owner, normalized view/query digest, `base_result_generation`, and only
dimension generations used by that query. Every page returns it and every continuation supplies
and cursor-binds it. Pre/post query mismatch discards page with `LIST_CHANGED`. Complete exactly-once
traversal holds only while membership and ordering stay unchanged. Recently Deleted cursor/version
bind `next_pending_deadline_us` as `membershipValidUntil`; continuation at or after it fails changed
before row mapping, independent of scheduler.

## Local Compose Draft

IndexedDB database: `cashmemo_local`, Dexie table `compose_drafts`. Never uploaded as draft.

| Field | Rules |
|---|---|
| `draft_id` | Local UUID primary key |
| `user_partition` | One-way local partition tag for signed-in user; prevents account mixing |
| `mode` | `create` or `edit` |
| `creation_id` | Required for create; generated once, reused on retry |
| `memo_id` / `base_revision` | Required for edit recovery |
| `form_payload` | User-entered values; sensitive; never console/crash logged |
| `retry_state` | `editing`, `submitting`, `retryable_failure`, `conflict` |
| `updated_at` | Local housekeeping only; never server truth |

Lifecycle: created when compose begins; updated on input; retained through network/conflict
failure; removed only after confirmed server success or explicit user discard. Account switch
must hide other partition and require explicit discard/return action. No generic replay queue,
server data cache, or background synchronization is stored.

## Suppression Ledger Entry

Independent encrypted backup-control object store; not Appwrite. Entry contains exactly:

| Field | Storage | Rules |
|---|---|---|
| `deletion_token` | Object key | `pt1.<key-id>.<base64url(first-192-bits(HMAC-SHA-256(key, domain || memo_id)))>` |
| `purged_at` | RFC 3339 UTC | Irreversible purge-commit instant |
| `removal_not_before_at` | RFC 3339 UTC | Max capable-backup deadline, or `purged_at` if none; not TTL |

`deletion_token` is keyed, non-reversible, and contains no owner/raw memo ID/memo metadata. Entry
contains no creation ID/fingerprint/financial content/reference/reason. Conditional create is
idempotent. No TTL or provider lifecycle may remove current/noncurrent token objects. Cleanup is
allowed only at or after `removal_not_before_at` and after verified destruction of every backup
capable of resurrecting memo; failure retains token, alerts, retries, and blocks cleanup. Dedicated
purge key is never fingerprint/cursor/session key.

## Backup Manifest

Independent operations inventory, separate from suppression ledger. It describes backup
artifacts, not individual users/memos.

| Field | Purpose |
|---|---|
| `backup_id` | Opaque artifact identifier |
| `capture_started_at`, `captured_at` | Establish containment ordering |
| `destruction_deadline_at` | At most exactly 30 days after capture |
| `scope_version` | Required Appwrite volumes/config/image set |
| `status` | `registered`, `capturing`, `complete`, `failed`, `destroyed` |
| `checksum`, `location_class` | Integrity and copy inventory; no user content |

Backup coordinator registers manifest before quiesced capture and serializes capture boundary
with purge. `removal_not_before_at` is maximum `destruction_deadline_at` over complete/in-progress
manifests whose snapshot can contain memo. Passing that instant only makes cleanup eligible;
verified artifact destruction remains mandatory.

## Export Fence

Not separate entity; lease fields live in user journal state. State transitions:

```text
unlocked
  -> acquiring (transaction-local only)
  -> locked(lease_id, accepted_at, deadline)
  -> released

locked -> expired -> transactionally stolen/released
locked + any read/serialization/schema/lease failure -> no bytes delivered
```

## State transitions

### Money Memo lifecycle

```text
create -> active(revision 1)
active --archive--> archived
archived --restore--> active
active|archived --delete confirmed--> pending_deletion(pre_delete_status, fixed deadline)
pending_deletion before deadline --restore--> pre_delete_status
pending_deletion --immediate purge confirmed--> deadline := now -> derived expired
pending_deletion at deadline --> derived expired (unreachable on every path)
derived expired --scheduled/access purge--> no row
```

Repeated archive/restore/delete is idempotent success only when request targets already-achieved
state defined by spec. Repeated delete never changes deadline. Field edit permitted only active.
Creation retry never changes lifecycle or revision.

### Lifecycle access matrix

| State | Active list | Archive | Recently Deleted | Search/filter | Export | Direct read | Restore | Physical data |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| active | yes | no | no | yes | default | yes | n/a | yes |
| archived | no | yes | no | archived filter | opt-in | yes | archive restore | yes |
| pending, before deadline | no | no | yes | no | no | Recently Deleted path only | yes | yes |
| expired | no | no | no | no | no | indistinguishable not-found | no | until purge worker/fallback |
| purged | no | no | no | no | no | indistinguishable not-found | no | no; suppression token only |

## Appwrite indexes

Exact names may be shortened for 36-character identifier limit. Provisioning waits for each
index `available` state and real-instance contract tests verify query plans/behavior.

### `money_memos`

1. Unique: `(owner_id, creation_id)`.
2. Key: `(owner_id, lifecycle_status, occurrence_instant_us DESC, created_at_us DESC, memo_id DESC)`.
3. Key: `(owner_id, lifecycle_status, occurrence_local_date, occurrence_instant_us DESC, created_at_us DESC, memo_id DESC)`.
4. Key each: `(owner_id, memo_type)`, `(owner_id, currency)`, `(owner_id, category_id)`,
   `(owner_id, money_space_id)`, `(owner_id, planned_status)`, `(owner_id, purpose)`.
5. Key: `(lifecycle_status, purge_deadline_us, memo_id)` for scheduled scan.
6. Key: `(owner_id, memo_id)` for explicit owner-scoped targeted access.

`note_search` deliberately has no full-text index because full-text semantics differ and
Appwrite contains implementation is not guaranteed index-backed. 10,000-row p95 evidence is
mandatory. Keep total well below current 64-index adapter bound.

### `labels`

1. Unique: `(owner_id, kind, name_key)`.
2. Key: `(owner_id, kind, state, name_key)` for picker.
3. Key: `(owner_id, kind, label_id)` for filter/reference load.

### `user_journal_state`

1. Unique: `(owner_id)`.

## Atomic transaction sets

- Create: state fence/version + memo + category count + Money Space count. Concurrent duplicate
  resolved by unique creation constraint and retry comparison.
- Edit: state + memo; when reference changes, decrement old/increment new label count in same
  transaction. Both or neither.
- Lifecycle mutation: state + memo.
- Label rename/state: state + label with expected revision.
- Label delete: state + label read/check/delete with count zero.
- Purge: suppression token durable first, then state + memo delete + two label decrements.
- Export lease: user state only; all later export-visible mutations conflict/block.

No transaction exceeds current self-host default 100-operation limit.

## Purge sweep surfaces

SC-021 “exhaustive” live sweep means these enumerated surfaces:

1. `money_memos` rows, including `note_search`, fingerprints, wrapped keys, lifecycle fields.
2. `labels` reference counts (must be decremented; no memo linkage stored).
3. `user_journal_state` (contains no memo identifier/content).
4. Browser compose draft/retry row for that memo/creation session.
5. API/Next caches and service worker caches (API responses forbidden from persistence).
6. Backend memory/temp export buffers.
7. Appwrite list cache (`ttl=0`; no Cashmemo cached list entries).
8. Logs, traces, metrics, OpenObserve, crash reports.
9. Backup artifacts within 30-day policy.
10. Independent suppression ledger, sole permitted live remnant until cleanup eligibility plus
    verified destruction of every capable backup.

Purge integration and restore tests inspect every applicable surface. Backups are reconciled, not
mutated in place; suppression token disappears only after `removal_not_before_at` and verified
destruction proves no retained backup can resurrect row.
