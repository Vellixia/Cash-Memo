# pgBackRest deployment contract

Cashmemo pins pgBackRest `2.59.0` (stable release reviewed 2026-08-13). The source archive SHA-256
is `faaf8faa14a6392279654ee216a493fcd07b0c513af4b55fe34faec062cb8875`.

The existing `cashmemo-test-postgres` service and persistent volume must be preserved. A later
Dokploy pass must first resolve the exact volume identity, take a verified backup, then attach the
pgBackRest process/config without recreating the database. WAL archiving requires `archive_mode=on`
and an `archive_command` that can execute the pinned pgBackRest binary against the same stanza.
Merely starting the repository container is not acceptable proof.

`pgbackrest.conf.template` is rendered by the deployment secret injector. Rendered config is never
committed or emitted as evidence. The Secondary bucket must already exist, be private, and have
versioning enabled. pgBackRest does not create the bucket.

Required deployment checks:

1. `pgbackrest --stanza=cashmemo check` succeeds.
2. Full then differential backup succeeds against synthetic data.
3. WAL switches are archived and repository metadata lists them.
4. An isolated PostgreSQL 18 restore to a target time is started with no application network.
5. Restored rows are inspected, then account-first and memo suppression reconciliation runs.
6. Valid neighboring rows survive; restored sessions are invalidated.
7. Restore copy is verified destroyed before its lineage registration is removed.

The same-host `cashmemo-rustfs-secondary-dev` is development integration only and records
`independent_failure_domain=false`. Production requires a separately operated host/failure domain.
SC-021 remains open until that production-equivalent drill passes.
