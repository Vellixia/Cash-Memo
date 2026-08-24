# Backup and recovery

Use encrypted external S3-compatible pgBackRest repository. Repository must be private and
versioned. Configure weekly full backups, daily differentials, continuous WAL archive, freshness
alerts, and monthly isolated restore/PITR drills. Set every `REQUIRED_AT_IMPLEMENTATION` value in
`infra/backup/pgbackrest.conf.example`; no retention value is implied by this repository.

Deletion receipts may expire only after proof that no restorable pre-purge backup remains, plus a
seven-day safety margin. Retain every HMAC key version while any receipt remains evaluable.

Use [restore runbook](../../infra/backup/restore-runbook.md) for every restore. Receipt replay uses
only an isolated restored DB, command-only keyring, and narrow receipt-bucket read credentials.
Replay wrapper writes target-bound, HMAC-signed restore evidence atomically; verify that artifact
before any restored target receives application traffic.
