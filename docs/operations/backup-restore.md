# Cashmemo Backup Restore Runbook

**Run owner**: Platform/Operations  
**Mandatory approver**: Security  
**Witness**: Money Memo backend owner  
**Cutover rule**: restored service stays non-routable until every reconciliation gate passes

## Goal

Restore self-hosted Appwrite without returning any purged Money Memo to live service. Restore is
always into fresh isolated stack at exact backed-up Appwrite/image/config versions. Application
never accesses Appwrite internal MongoDB directly; reconciliation uses supported TablesDB APIs.

## Preconditions

- Incident/change ticket and named run owner.
- Selected backup manifest status `complete`, checksum verified, within 30-day retention.
- Exact Appwrite 1.9.6 image digest/backend adapter and full scope manifest available.
- Appwrite encryption secret and Cashmemo KEK/purge-key escrow recovered from separate secret
  control and verified without logging value.
- Current independent suppression ledger reachable and inventory complete.
- Fresh isolated network/host with no public DNS, ingress, email/SMS side effects, analytics, or
  user sessions.
- Restore clock source healthy; target remains deny-all if clock/ledger/key incomplete.

If any precondition fails, stop. Do not serve a partially restored stack.

## Procedure

### 1. Declare and isolate

1. Open restore record with random run ID; record backup ID, versions, owners, start time.
2. Disable public routing before starting containers.
3. Create fresh volumes and exact pinned Compose stack. Never restore over live Appwrite.
4. Configure outbound network allowlist only for independent ledger/secret/telemetry endpoints.
   Telemetry remains strict allowlist and contains no record identifiers/content.

### 2. Restore opaque snapshot

1. Verify backup and per-volume checksums.
2. Restore opaque volumes/config to fresh targets. Do not use `mongodump`, `mongorestore`, shell
   queries, or direct database manipulation.
3. Restore exact `_APP_OPENSSL_KEY_V1` through secret mount.
4. Start Appwrite privately and wait for vendor health checks/migrations appropriate to backed-up
   exact version.
5. Keep Cashmemo HTTP mode disabled. Start only `cashmemo restore-reconcile`.

### 3. Load suppression control plane

1. Read current ledger inventory independent of restored snapshot.
2. Load every purge-token key version referenced by a retained ledger token.
3. Verify token objects contain exactly `deletion_token`, `purged_at`, and
   `removal_not_before_at`; verify token is keyed/non-reversible and reject unexpected fields.
4. Verify no token was removed solely because `removal_not_before_at` passed, and every removed
   token has signed proof that all capable backups were destroyed before cleanup.
5. If ledger listing is partial/eventually inconsistent beyond verified store contract, stop.

### 4. Reconcile restored Money Memos

Use supported TablesDB APIs with list cache disabled and application keyset enumeration.

For every restored memo row:

1. Validate row schema and owner/reference integrity without emitting values.
2. For every retained purge-key version, compute versioned deletion token from memo ID in memory.
3. If any token exists in live ledger, transactionally delete memo/search shadow, decrement both
   label reference counts, and bump owner state. Emit aggregate count only.
4. If `pending_deletion && purge_deadline <= restore_clock`, treat row unreachable immediately;
   create/verify suppression token and physically purge before serving.
5. Leave unexpired pending-deletion row pending with original deadline and pre-delete status.
6. Do not expose creation fingerprint, key wrap, note search, deletion fields, or owner in output.

Retries are idempotent. Any transaction conflict is refetched/retried within bound; unresolved
conflict stops restore.

### 5. Prove reconciliation closure

Run full second enumeration from beginning after all deletes:

- zero restored memo ID maps under any retained purge key to live suppression token;
- zero expired pending-deletion row remains;
- label reference counts equal actual active+archived+pending references;
- every memo label belongs to same owner and exists, active or deactivated;
- owner state rows exist and no export lease remains active from restored past;
- no API/server cache can return pre-reconciliation data (`ttl=0`, services not yet routed).

Any discrepancy stops restore.

### 6. Acceptance gates before cutover

Run with two isolated test accounts and synthetic content:

1. Auth session validation and fail-closed revoked/unknown session.
2. Cross-user read/list/search/filter/export/mutation/label matrix.
3. Active/archive/Recently Deleted visibility and exact deadline boundary.
4. Creation retry after edit and stale revision conflict.
5. Search case/diacritic behavior and no pending rows.
6. Export schema/reference/internal-field checks.
7. Full privacy canary scan over HTTP errors, Appwrite/backend logs, OTLP, and OpenObserve.
8. Suppression second scan and restored-backup negative proof.
9. Health, index availability, worker dry run, and backup-control connectivity.

Security signs suppression and privacy gates. Backend owner signs domain integrity. Platform signs
infrastructure/checksum/health. All three approvals required.

### 7. Cut over

1. Put current production in maintenance mode if still available.
2. Run final ledger delta inventory and reconciliation scan; any new token repeats deletion pass.
3. Confirm no active export/backup/purge coordination lease.
4. Enable public routing to restored stack.
5. Monitor auth failures, safe error-code rates, aggregate purge backlog, latency, and health.
6. Keep old stack isolated, never routable, only until cutover validation finishes; destroy it
   inside its existing retention deadline.

## Fail-closed conditions

Do not cut over when any of these occur:

- missing/invalid Appwrite encryption key, fingerprint KEK, purge key, or ledger access;
- backup version/scope/checksum mismatch;
- backup restored into non-fresh target;
- incomplete memo enumeration or Appwrite list error;
- unknown ledger field, prematurely removed token, overdue backup artifact, or unverified replica;
- suppression match cannot be deleted atomically;
- expired pending-deletion row remains;
- label counts/references inconsistent;
- privacy/cross-user/export/acceptance test fails;
- direct MongoDB access would be required.

Availability loss is preferable to resurrecting purged data.

## Correctness argument

Let `B` be memo rows in restored backup. Let `L` be every retained independent suppression token.
Serving gate admits only:

```text
{m in B |
  m is not expired
  and for every retained purge key k: token_k(m.id) is not in L}
```

Purge protocol durably writes token before physical row delete. `removal_not_before_at` is only
earliest cleanup eligibility. Token remains until current time is at or after that instant and last
backup that may contain row is verified destroyed; TTL and provider lifecycle never remove it.
Therefore every retained backup containing a purged row has matching token during restore. Full
supported-API enumeration removes all matches before routing; second scan proves no known match
remains. Proof fails closed if ledger, cleanup evidence, keys, inventory, or enumeration is
incomplete.

## Real drill procedure and cadence

Quarterly, Platform selects latest production-like encrypted backup and performs entire runbook
in isolated environment. Seed/use synthetic verification users; never send email/SMS. Security
witnesses ledger reconciliation; backend owner witnesses domain checks. Destroy drill environment
within 24 hours and no later than source backup deadline.

Before Feature 001 release, automation performs 100 separate real Appwrite restore/reconcile
cycles. Repeat after Appwrite version/backend, backup mechanism/scope, retention, suppression-token
construction, key management, or reconciliation changes. Mock restoration does not count.

Drill report records run/backup IDs, version digests, aggregate row/token counts, cleanup-eligibility
check, destruction-verification result, alert/retry outcome for injected failure, duration, gate
results, approvals, and destruction receipt. It contains no memo IDs, owners, amounts, notes,
queries, fingerprints, tokens, or export bytes.

## Rollback

Before public cutover: destroy failed restored stack and restart from fresh target. Never repair
failed target with direct database edits. After cutover: declare incident, disable routing, and
repeat fresh restore with newer valid backup/ledger snapshot. Never route old pre-reconciliation
stack as fallback.

## References

- [Appwrite self-hosted backups and fresh-restore requirement](https://appwrite.io/docs/advanced/self-hosting/production/backups)
- [Cashmemo backup retention policy](backup-retention.md)
- [Feature data model](../../specs/001-money-memo-foundation/data-model.md)
- [Feature test strategy](../../specs/001-money-memo-foundation/test-strategy.md)
