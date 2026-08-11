# Backup and Restore Reconciliation

Status: production-safe procedure definition. Phase 13 validates local contracts only. Real isolated
RDS PITR drill, measured RPO/RTO, and SC-021 closure remain T268.

## Trigger, ownership, and approval

Use for incident recovery, approved continuity drill, or reviewed infrastructure change. Data
Operations owns execution; SRE owns isolation and AWS controls; Security/Privacy owns release
review. Require two-role approval before restore creation and before controlled release. Never use
production customer identifiers in tickets or evidence.

## Restore procedure

1. Record approved reason, immutable build/config versions, synthetic procedure ID, and owners.
2. Select RDS PITR point within approved recovery window. Record measured RPO/RTO only during real
   T268 execution; never estimate them into evidence.
3. Create restore copy with deterministic operational identity and mandatory lineage tags. Register
   it before API completion is treated as success.
4. Enforce network isolation: no ALB, public route, application worker, outbound provider access, or
   customer session path.
5. Confirm copy appears in authoritative backup-lineage inventory. Inventory unavailable, stale,
   incomplete, or unverifiable means STOP.
6. Run pre-network reconciliation. Check account suppression before memo suppression. Match every
   retained HMAC key version. Purge suppressed restored data, sweep expired Recently Deleted/drafts,
   and revoke restored sessions.
7. Verify valid synthetic neighboring accounts and memos survive unchanged. Any suppressed
   resurrection or neighboring-data loss means STOP.
8. Run mandatory content-safe checklist. Missing ledger, key, inventory proof, or incomplete
   reconciliation blocks release without warnings-as-success.
9. If authorized controlled use is needed, obtain second release approval after verification.
   Otherwise destroy immediately.
10. Destroy restore copy, verify destruction through authoritative inventory, and update lineage
    state. Copy remains cleanup blocker until verified absent.

## Release, rollback, and escalation

Release only after reconciliation returns PASS and every approval exists. BLOCKED leaves copy
isolated. Rollback means deny release, preserve suppression records/keys, keep evidence
content-free, and destroy copy when investigation permits. Escalate ledger/key/inventory failures to
Data Operations, SRE, and Security. Never bypass with force-release.

## Evidence limits

Allowed: scenario IDs, timestamps, tool/build/config versions, coarse states, hashes, RPO/RTO
measurements from real drill. Forbidden: raw IDs, tokens, keys, financial content, snapshot names
outside approved operational allowlist, request/response payloads.
