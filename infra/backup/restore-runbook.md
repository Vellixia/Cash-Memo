# Isolated V1 restore runbook

1. Create disposable, isolated PostgreSQL target with no web/API route. Never reuse production,
   legacy, backup, or Dokploy database target.
2. Record backup ID, freshness evidence, target timestamp, and pgBackRest `check` output. Restore
   with `pgbackrest --stanza=cashmemo-v1 --type=time --target=TIMESTAMP restore`.
3. Start restored PostgreSQL only. Do not start `serve`; use narrow read-only receipt-bucket
   credentials and HMAC keyring only with `scripts/replay-deletion-receipts.sh`.
4. Store unsigned replay JSON. `unreadable_receipts` and `unprocessed_matches` must both be zero.
   Any nonzero value keeps target isolated and requires investigation/replay.
5. Run `scripts/verify-restore.sh --evidence restore-evidence.json`. Application traffic remains
   disabled until separate operator approval and production replacement gate.

Weekly full, daily differential, and continuous WAL archiving are required. Run a monthly isolated
restore/PITR drill. RPO/RTO are targets until those drills prove them.

Run weekly full backup with `pgbackrest --stanza=cashmemo-v1 backup --type=full` and daily
differential with `pgbackrest --stanza=cashmemo-v1 backup --type=diff`. PostgreSQL must set
`archive_mode=on` and `archive_command='pgbackrest --stanza=cashmemo-v1 archive-push %p'` for
continuous WAL archive.
