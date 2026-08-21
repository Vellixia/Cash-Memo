# Task 13 verification report

Status: DONE

## Disposable targets

- PostgreSQL 16-alpine container `cashmemo-task13-pg`, mapped only to local port 55432.
- MinIO container `cashmemo-task13-minio`, mapped only to local port 59000.
- Dedicated `deletion-receipts` bucket created with disposable MinIO credentials.
- Both containers are removed after verification; no production endpoint or credential was used.

## TDD evidence

- Added lifecycle tests before final verification. The initial DB-failure test was red because
  PostgreSQL rejects multiple commands in one prepared statement; split it into separate trigger
  creation calls, then it passed.
- Added concrete `s3-receipts` tests. A repeat run initially exposed persistent-object test
  pollution; tests now use a fresh HMAC/object key per execution and pass repeatedly.

## Passing checks

```text
DATABASE_URL=<disposable-pg> TEST_DELETION_RECEIPT_S3_*=<disposable-minio> \
  cargo test -p cashmemo-api --features s3-receipts \
  --test account_deletion --test deletion_receipts

account_deletion: 4 passed
deletion_receipts: 2 passed

cargo fmt --check
cargo clippy -p cashmemo-api --all-targets -- -D warnings
cargo clippy -p cashmemo-api --all-targets --features s3-receipts -- -D warnings
git diff --check
```

Fresh `DATABASE_URL=<disposable-pg> cargo test -p cashmemo-api` passed after the migration
target-guard and deterministic email-queue test fixes. The focused resend test also passed 5/5.

Concrete coverage proves first S3 PUT/body retrieval, identical retry recognition,
divergent-object fail-closed behavior, receipt failure preserving live purging data, DB deletion
failure followed by receipt recognition/retry, and successful conditional cascade. PostgreSQL
runtime coverage proves recent-password confirmation, transactional session revocation, seven-day
grace, deletion-only login, atomic claim, and cancel failure after claim.

## Follow-up

The auth email-queue test now uses a sender completion signal rather than a scheduling-sensitive
wall-clock bound. Migration target-guard and replay tests now include migration 0008.
