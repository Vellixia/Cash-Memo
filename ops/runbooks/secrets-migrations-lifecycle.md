# Secrets, migrations, and lifecycle operations

## Secret compromise or rotation

Contain principal, revoke sessions/credentials where applicable, rotate only through Secrets
Manager, restart tasks to fetch new versions, and validate least-privilege role access. Runtime must
never receive migration/restore credentials. Use privacy incident procedure if content exposure is
possible.

## Migration or deployment failure

Stop promotion, retain advisory-lock evidence, and use deployment rollback/safe-forward decision.
Never run concurrent migrators or destructive automatic down migrations. Validate exact
image/commit, schema compatibility, migration checksums, RLS, and core synthetic health.

## Temporary audio and lifecycle backlog

Audio deletion backlog is urgent: stop new voice admission if cleanup capacity is uncertain,
preserve manual capture, run lifecycle owner/sweeper, and prove durable audio copies remain zero.
Draft/export/deletion job backlog uses leases, bounded retries, and fixed error classes. Failed
purge remains inaccessible and incomplete.

## S3/KMS and deletion ledger

Export object failure remains explicit. Ledger write failure blocks hard deletion. Inventory
unavailable or stale retains suppression records and key versions, alerts, and retries. Integrate
backup/restore and suppression-cleanup runbooks; time alone never authorizes cleanup.
