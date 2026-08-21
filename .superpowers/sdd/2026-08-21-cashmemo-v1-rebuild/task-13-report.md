# Task 13 verification report

Status: DONE

## Root-cause correction

- `0008_account_deletion.sql` was present but `target_guard` treated migration 7 as latest.
- The guard now accepts every exact contiguous checked prefix through 1..8 and requires 1..8 for
  latest. Unknown versions, gaps, failed migrations, and checksum changes remain rejected.
- Prefix-upgrade tests explicitly reverse 0008 index/columns before deleting migration rows, then
  prove 1..4, 1..5, and 1..7 upgrade to latest 1..8 without replay collisions.

## Deterministic auth test

- Replaced wall-clock `<200ms` assertion with a delayed fake sender completion signal.
- The test asserts `resend_verification` returns before the queued SMTP send completes.
- Focused auth test passed 5/5 against disposable PostgreSQL.

## Runtime evidence

- `cargo test -p cashmemo-api --test migrations`: 8 passed.
- `cargo test -p cashmemo-api --features s3-receipts --test account_deletion --test deletion_receipts`:
  account lifecycle 4 passed; concrete MinIO S3 receipt tests 2 passed.
- Concrete coverage includes receipt creation/body/key, identical retry, divergent-object
  fail-closed, receipt failure retaining live purging data, PostgreSQL-delete failure then receipt
  retry, and final conditional cascade.
- `cargo fmt --check`, default strict Clippy, feature strict Clippy, and `git diff --check` pass.

## Isolation

- Verification uses only disposable PostgreSQL 16 and MinIO containers on local mapped ports.
- No production endpoint or credentials were used. Containers are removed after verification.

## Reviewer follow-up

- Login now locks its user row and inserts the session in that transaction, sharing the deletion
  request lock. The PG concurrency regression proves no Full session remains after transition.
- Purge renews a live claim before receipt I/O and final deletion predicates a still-live lease.
  Takeover and delayed-PUT expiry regressions prove a stale claimant cannot delete.
- Receipt endpoints require HTTPS except explicitly enabled test/development loopback/MinIO HTTP;
  the S3 client uses forced path-style addressing. Remote plaintext HTTP regression is rejected.
