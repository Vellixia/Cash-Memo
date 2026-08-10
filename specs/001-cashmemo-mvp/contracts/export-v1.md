# Cashmemo Export Contract 1.0

## Package

Filename: `cashmemo-export-YYYY-MM-DD.zip`. ZIP entry names are fixed ASCII and sorted bytewise:

```text
manifest.json
preferences.json
categories.json
categories.csv
money-spaces.json
money-spaces.csv
money-memos.json
money-memos.csv
drafts.json                 # present only when requested; always non-authoritative
drafts.csv                  # present only when requested
lifecycle.json
```

All files use UTF-8 without BOM and LF line endings. JSON is RFC 8259 with lexicographically sorted object keys, arrays in the order defined below, and no insignificant whitespace. CSV follows RFC 4180 with one header row, fixed column order, CRLF records, and formula-injection protection for cells beginning with `=`, `+`, `-`, `@`, tab, or carriage return. CSV protection is documented in the manifest and never changes JSON values.

## Manifest

```json
{
  "accountId": "uuid",
  "authoritativeRecordType": "money_memo",
  "createdAt": "RFC3339 instant",
  "currencyRegistryVersions": ["string"],
  "exportId": "uuid",
  "files": [
    {
      "bytes": "non-negative decimal integer string",
      "mediaType": "application/json",
      "name": "money-memos.json",
      "records": "non-negative decimal integer string",
      "sha256": "lowercase hex"
    }
  ],
  "includesRecoverableDrafts": false,
  "schemaVersion": "1.0",
  "snapshotCutoff": "RFC3339 instant",
  "timezoneSemantics": "instant+local+iana-zone+offset",
  "valueEncoding": "money-decimal-and-minor-units-as-strings; no conversion"
}
```

The `accountId` is the user's own product UUID, included because this is their data. It never enters operational evidence/logs. File checksum/byte counts are used only inside the package and protected job row.

## Ordering and Snapshot

- Export reads one repeatable-read snapshot with `snapshotCutoff` captured at transaction start.
- Preferences: one object.
- Categories: `kind`, normalized display name, immutable ID.
- Money Spaces: normalized display name, immutable ID.
- Money Memos: `occurredAt ASC`, `id ASC`.
- Drafts: `createdAt ASC`, `id ASC`.
- Lifecycle entries: event time, immutable subject ID, lifecycle code.
- Recently Deleted memos may appear only in `lifecycle.json` with user-visible recovery metadata, not in the confirmed `money-memos` file. Purged content never appears.

## Money Memo JSON Record

```json
{
  "amount": "85000",
  "amountMinor": "85000",
  "authoritative": true,
  "categoryId": "uuid-or-null",
  "createdAt": "RFC3339 instant",
  "currency": "IDR",
  "currencyExponent": 0,
  "currencyRegistryVersion": "cldr-47-cashmemo-1",
  "direction": "expense",
  "id": "uuid",
  "lifecycle": "active-or-archived",
  "moneySpaceId": "uuid-or-null",
  "note": "string-or-null",
  "occurredAt": "RFC3339 instant",
  "occurredLocal": "ISO local date-time",
  "occurredOffsetMinutes": 420,
  "occurredTimezone": "Asia/Jakarta",
  "origin": "manual-or-natural_language-or-voice",
  "planningStatus": "planned-or-unplanned-or-null",
  "purpose": "personal-or-work-or-mixed-or-null",
  "revision": "positive integer string",
  "timezoneDatabaseVersion": "string",
  "updatedAt": "RFC3339 instant"
}
```

No converted value, base currency, exchange rate, consolidated total, provider output, provider request ID, obsolete revision value, or diagnostic field exists.

## Money Memo CSV Columns

```text
id,authoritative,direction,amount,amount_minor,currency,currency_exponent,
currency_registry_version,occurred_at,occurred_local,occurred_timezone,
occurred_offset_minutes,timezone_database_version,category_id,money_space_id,
purpose,planning_status,note,origin,lifecycle,revision,created_at,updated_at
```

Null is an empty CSV cell; empty user text is normalized to null at product validation, so ambiguity does not arise.

## Draft Record

Drafts are included only when the user selected them and they are recoverable at `snapshotCutoff`:

```json
{
  "authoritative": false,
  "captureStartedAt": "RFC3339 instant",
  "captureTimezone": "IANA zone",
  "expiresAt": "RFC3339 instant",
  "fields": { "same nullable candidate fields as OpenAPI Draft" : "..." },
  "id": "uuid",
  "lastActivityAt": "RFC3339 instant",
  "origin": "manual-or-natural_language-or-voice",
  "revision": "positive integer string",
  "sourceCompleteness": "complete-or-incomplete-or-not_applicable",
  "sourceText": "string-or-null",
  "status": "editing-or-processing-or-reviewable-or-blocked-or-failed_recoverable"
}
```

Provider-native metadata, raw audio, detector results/derivatives, hidden reasoning, and discarded/expired drafts are excluded.

## Preferences and Labels

- `preferences.json`: default currency, reporting timezone, locale, revision, and accepted privacy notice version/timestamp.
- Category: ID, kind, display name, active/inactive status, revision, created/updated timestamps.
- Money Space: ID, display name, active/inactive status, revision, created/updated timestamps.
- No label is represented as an account, balance, institution, or payment source.

## Lifecycle File

Contains only current user-visible lifecycle metadata:

```text
subjectType: money_memo | export | account
subjectId: owned UUID
state: documented product lifecycle enum
deletedAt: instant | null
purgeAfter: instant | null
priorState: active | archived | null
```

Content-free internal audits, deletion-suppression tokens, sessions, session bearer tokens, one-time/reauthentication token hashes, job leases, provider attempts, and operational deletion evidence are not user export data and are excluded.

## Deterministic Completeness Verification

The export job records snapshot counts by data class inside protected job execution, compares serialized record counts, verifies each file checksum, then verifies the manifest checksum. Acceptance recomputes current-month/monthly totals from `money-memos.json` using the documented eligibility, timezone, and per-currency rules and requires an exact match. Evidence records only fixture IDs, counts, hashes, and pass/fail—not exported values.

## Versioning

- Additive optional fields require a `1.x` schema and updated documented consumer behavior.
- Removing/renaming fields, changing nullability, money/time encoding, file names, or lifecycle meaning requires `2.0` and side-by-side support during a declared migration window.
- Every package declares exactly one schema version; server never silently substitutes another requested version.
