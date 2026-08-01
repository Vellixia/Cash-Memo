# Cashmemo Backup Retention Policy

**Policy owner**: Platform/Operations  
**Privacy approver**: Security  
**Effective**: Feature 001 release  
**Maximum backup retention**: exactly 30 days from successful capture instant

## Purpose and invariants

Backups recover self-hosted Appwrite and Cashmemo deployment after operational failure. They
must never undo permanent Money Memo deletion.

1. Every backup copy has registered capture instant and destruction deadline no later than
   capture + 30 days.
2. “Backup” includes automated, manual, provider snapshot, replica, copied archive, temporary
   staging file, restore-drill source, and operator-created safety copy.
3. No legal-hold, “keep forever,” manual pin, or untracked copy exists in this feature.
4. Backup expiration means every recoverable copy and noncurrent/versioned replica is physically
   destroyed and absence verified. Nominal lifecycle date alone is insufficient.
5. Suppression entry remains until last backup capable of containing its memo is verified
   destroyed. Its `removal_not_before_at` is the maximum registered destruction deadline among
   those backups and is only earliest cleanup eligibility, never automatic expiry.
6. Missing inventory, failed destruction, or inconsistent manifest is privacy incident. Restore
   and suppression cleanup fail closed.
7. Suppression tokens and their current/noncurrent object versions have no TTL or provider
   lifecycle expiration. Time alone never authorizes token removal.

## Objectives

- RPO: at most 24 hours under successful daily schedule.
- RTO target: four hours from restore declaration to gated cutover.
- Daily cold/quiesced full-stack snapshot at 02:00 UTC.
- Maximum retention: 30 × 24 hours from `captured_at`, including manual backups.
- Restore-drill working copies: destroy within 24 hours and never later than source backup's
  original 30-day deadline.

RPO/RTO are operational targets, not permission to extend retention.

## Scope

Each backup manifest must cover exact Appwrite 1.9.6 stack scope:

- all Appwrite database/storage/config/cache-related named volumes required for full recovery;
- Appwrite project/Auth/TablesDB state as opaque volume data;
- pinned Compose/Dokploy manifests and image digests;
- encrypted runtime configuration, including exact Appwrite `_APP_OPENSSL_KEY_V1` required to
  decrypt Appwrite-held data;
- Cashmemo configuration schema and key identifiers;
- OpenTelemetry/OpenObserve configuration needed to restore safe diagnostics, but not retained
  telemetry data unless separately covered by its own retention policy.

Cashmemo KEKs, purge-token keys, Appwrite encryption secret, and recovery credentials are escrowed
encrypted in separate secret-control system. They are not stored beside data backup. Each key is
retained at least until every backup/token requiring it is destroyed.

Canonical suppression ledger and backup manifest catalog live in encrypted backup-control bucket
outside Appwrite backup rollback unit. They are not replaced by restored Appwrite snapshot.

## Approved backup method

Use quiesced opaque named-volume or provider system/block snapshot. Never query, dump, restore, or
modify Appwrite internal MongoDB directly.

Backup coordinator:

1. Acquires global backup/purge coordination lease.
2. Registers manifest as `capturing` before any snapshot can contain state.
3. Places Cashmemo in maintenance mode and drains HTTP mutations/purge worker.
4. Stops every Appwrite writer as one stack.
5. Captures all required volumes/config with encryption and checksum.
6. Records exact `captured_at`, `destruction_deadline_at = captured_at + 30 days`, scope version,
   locations, checksums, and status `complete`.
7. Restarts/health-checks Appwrite and Cashmemo, then releases coordination lease.
8. If capture fails, marks artifact failed and destroys partial copies immediately.

This is operations-level opaque backup following Appwrite self-host guidance. Application and
restore reconciliation still use supported Appwrite APIs only.

## Backup/purge ordering

Manifest registration and purge are serialized at capture boundary:

- Backup wins lease first: manifest is visible as in-progress before snapshot; purge calculates
  `removal_not_before_at` including this backup, then may continue after snapshot boundary.
- Purge wins first: suppression token is durable and memo deletion commits before later backup;
  later snapshot cannot contain memo.
- Unknown/incomplete ordering: purge does not physically delete and backup does not become
  restorable until manifest is reconciled.

For each purge, ledger `removal_not_before_at` is maximum registered destruction deadline among all
complete or in-progress backups capable of containing memo. It is not blindly
`purged_at + 30 days`; when no capable backup exists it equals `purged_at`. It does not authorize
deletion without verified destruction closure.

## Storage controls

- Encryption in transit and at rest; keys in separate secret-control system.
- Bucket denies public access and broad operator listing.
- Backup object versioning/noncurrent replicas follow same 30-day maximum.
- Suppression-token prefix explicitly disables TTL and provider lifecycle deletion for current,
  noncurrent, and replicated token objects.
- Conditional writes and checksums; immutable completed backup bytes.
- Daily inventory compares provider objects/versions/replicas to manifests.
- Geographic/offsite copy allowed only if separately inventoried with same or earlier deadline.
- Application logs never contain object names that encode user/memo data. Backup IDs are random.
- Suppression entry contains exactly keyed non-reversible `deletion_token`, `purged_at`, and
  `removal_not_before_at`; token contains no owner, raw memo ID, or memo metadata.

## Expiration workflow

At each registered backup destruction boundary and on every retry after a failed verification:

1. Delete every primary, replica, noncurrent version, multipart fragment, and temporary copy.
2. Query provider inventory and verify absence/checksum catalog closure.
3. Mark manifest `destroyed` with operational evidence.
4. Recompute affected suppression entries. A token becomes cleanup-eligible only when current time
   is at or after `removal_not_before_at` and inventory proves every backup capable of containing
   corresponding memo is physically destroyed.
5. Conditionally delete eligible suppression token and every replica/noncurrent version, then
   verify absence. Time alone, lifecycle rules, or a nominal deadline never satisfy this step.

Provider lifecycle rules may help destroy backup artifacts but are not proof and MUST NOT target
suppression tokens. If backup deletion cannot be verified, manifest remains capable-of-resurrection
and suppression entry remains regardless of `removal_not_before_at`. Platform pages incident
commander immediately, Security records breach of intended 30-day maximum, cleanup and affected
restore cutover remain blocked, and verification retries until closure. Never delete token merely
to make retention dashboard green while a backup remains.

## Monitoring and cadence

| Control | Owner | Cadence / threshold |
|---|---|---|
| Backup run and checksum | Platform | Daily; alert on any failed run |
| Complete inventory reconciliation | Platform | Daily |
| Artifact destruction verification | Platform | At every deadline; page immediately on miss |
| Suppression cleanup-gate reconciliation | Platform + Security | Every destruction boundary and retry until verified |
| Key inventory/escrow restore | Security | Quarterly |
| Real isolated restore drill | Platform + Security | Quarterly |
| 100-cycle real restore qualification | Platform + Security | Before release and after material backup/Appwrite/purge change |
| Policy review | Platform, Security, Product | Quarterly and after incident/provider change |

## Evidence

Store signed manifests, checksums, inventory diffs, destruction receipts, cleanup eligibility time,
verification attempts, alert delivery, blocked-cleanup decision, retry history, drill reports, and
approvals in access-controlled operations evidence. Evidence contains backup IDs and aggregate
counts only, never amounts, notes, search terms, memo IDs, fingerprints, purge tokens, or export
data.

## Exceptions

None pre-approved. Any longer retention requires constitution/spec amendment plus migration
impact review. Before extension, every live `removal_not_before_at` must be recomputed so no backup
can outlive its deletion token. Until that work completes, extension is prohibited.

## References

- [Appwrite self-hosted backup guidance](https://appwrite.io/docs/advanced/self-hosting/production/backups)
- [Dokploy volume backups](https://docs.dokploy.com/docs/core/volume-backups)
