# Deletion Suppression Cleanup and Key Rotation

Critical rule: **"old enough" does NOT mean "safe to delete."** `removal_not_before_at` is
necessary, never sufficient.

## Verifier operation

1. Load suppression record through privileged cleanup boundary.
2. Confirm removal floor reached. Before floor: retain and retry later.
3. Obtain complete, current authoritative lineage inventory across automated/PITR, retained
   automated, manual, final, copied, shared, AWS Backup, replica, cross-region, and temporary
   restore-copy classes.
4. Classify every artifact. Present resurrection-capable, active restore-copy, unregistered, or
   unverifiable artifact means retain token/key, alert, retry.
5. Confirm no restore reconciliation still requires record or its HMAC key version.
6. Remove record using exact verified object version. Version mismatch means STOP and re-inventory.
7. Retire old HMAC key only after zero suppression records and zero lineage dependencies under
   complete/current proof.

## Key rotation

Create and activate new version without deleting old material. Store keys only in approved
secret/KMS boundary. Reconciliation searches every retained version. Never print key material,
deletion tokens, raw identities, or derivatives. Rotation failure retains existing active version
and alerts.

## STOP conditions

- Inventory unavailable, stale, incomplete, paginated response incomplete, or unverifiable.
- Any capable or unregistered artifact remains.
- Restore copy exists or destruction is not authoritatively verified.
- Required HMAC key is missing.
- Suppression object/version verification fails.
- Policy drift or release-blocking tag/control failure exists.
- Only elapsed time is known.

On STOP: retain record and key, emit content-free alert, schedule bounded retry, escalate repeated
failures to Data Operations/SRE/Security. No ordinary runtime force-delete path exists. Exceptional
action requires separate governed privileged procedure and cannot claim SC-021 closure.
