# Self-hosted service outages

All diagnostic/evidence records use fixed codes, durations, counts, build/digest, and resource
references only. Never copy request/provider/database/object bodies, credentials, endpoints with
queries, or user values.

## PostgreSQL / pgBackRest

On PostgreSQL uncertainty, authoritative reads/writes fail closed. Do not recreate the existing
service or volume. Verify service/volume IDs, health, disk, connection roles, migrations, and RLS.
For data loss/corruption use `backup-restore.md`; no application network is released before
restored-state inspection and suppression reconciliation. pgBackRest check, backup, WAL, or
repository failure alerts and blocks suppression cleanup. A same-host Secondary loss is a
development incident, not evidence of production resilience.

## RustFS Primary

Exports become unavailable or pending; journal authority remains in PostgreSQL. Stop new export
generation if versioning, private access, head/checksum, or every-version deletion is uncertain. Do
not expose direct object URLs. Reconcile ambiguous writes before retry. Raw audio is never
redirected to object storage.

## RustFS Secondary / deletion ledger

Any unavailable, ambiguous, unencrypted, checksum, version, or conditional-write result blocks hard
deletion. Keep the entity inaccessible in `purging`, retain token/key version, alert, and retry. No
time or lifecycle rule authorizes ledger removal.

## Cloudflare Email Service

Map responses to fixed temporary/permanent categories. Signup/reset remains generic and cannot grant
authority from delivery state. Never log destination, one-time URL, token, provider body, or raw
error. Mailpit is development-only and is not a production fallback.

## Shared OTLP/OpenObserve

Telemetry outage must not change journal authority. Safe telemetry may drop/buffer within its
declared bound. Do not add arbitrary logging as a fallback. Seeded canary scan remains mandatory
after recovery.

## Shared Infisical/runtime injection

Missing required secret names fail process startup with names only. Never print or copy values. Do
not deploy a second secret service. Rotate only through approved owner procedure and restart
API/worker from the same immutable digest.
