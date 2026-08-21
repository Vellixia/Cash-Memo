# Task 13 verification report

Status: DONE_WITH_CONCERNS

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

Concrete coverage proves first S3 PUT/body retrieval, identical retry recognition,
divergent-object fail-closed behavior, receipt failure preserving live purging data, DB deletion
failure followed by receipt recognition/retry, and successful conditional cascade. PostgreSQL
runtime coverage proves recent-password confirmation, transactional session revocation, seven-day
grace, deletion-only login, atomic claim, and cancel failure after claim.

## Concern

The full default backend suite was run against the same disposable PostgreSQL. It had one unrelated
timing-sensitive pre-existing failure:

```text
auth::resend_uses_common_public_response_deadline_without_waiting_for_smtp
assertion: elapsed < 200ms
```

The test's 200ms latency assertion failed under local test load; all other shown auth tests and the
Task 13 focused tests passed. This is recorded rather than changed because Task 13 does not alter
resend timing behavior.
