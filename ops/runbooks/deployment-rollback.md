# Deployment rollback and safe-forward

## Trigger and evidence

Trigger on Dokploy health rollback, failed migration verification, failed synthetic health, or core
error burn. Record incident ID, build SHA, image digest, schema version, fixed status codes,
durations, and artifact hashes only.

## Decision

1. Stop promotion. Keep previous immutable digest available.
2. Run `node scripts/deploy/rollback-or-safe-forward.mjs <content-safe-manifest.json>`.
3. `ROLLBACK_SAFE`: bind both API and worker to the previous immutable image digest, wait healthy,
   then run core synthetic verification.
4. `SAFE_FORWARD_REQUIRED`: keep current schema, deploy reviewed corrective image using same gated
   workflow. Never run destructive down migration.
5. `BLOCKED_MANUAL_ESCALATION`: disable affected capability where safe, fail core writes closed if
   compatibility is uncertain, and escalate to release/SRE/data operations owners.

## Validation

Verify health, migration table/checksums, RLS identity context, manual capture, history, and
deletion jobs. Provider failure may leave manual journal available; DB/auth/schema uncertainty
requires authoritative writes to fail closed.

## Rehearsal

Use synthetic manifests covering rollback-safe, safe-forward-required, and manual-escalation
decisions. Never use production content in rehearsal or evidence.
