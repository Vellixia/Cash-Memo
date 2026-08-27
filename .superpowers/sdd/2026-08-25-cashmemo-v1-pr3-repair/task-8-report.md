# Task 8 report: Read-only schema-aware readiness

## Root cause

`/api/v1/health/ready` checked only `SELECT 1`. It reported `200` for every reachable database,
including empty, stale V1, failed migration, checksum-divergent, and unknown non-empty states.

## RED

Added isolated endpoint tests for exact current V1, empty, stale migration-prefix, failed migration,
checksum divergence, and unknown non-empty state. Before fix, five invalid-state tests failed:
`200`, expected `503`.

## GREEN

Added `check_latest_v1_readiness(&PgPool) -> Result<(), ReadinessError>`. It reuses target guard
identity and migration checksum validation through V1 migration 9, without invoking migration or
initialization. Readiness maps every validator mismatch and database error to existing canonical
`SERVICE_UNAVAILABLE` response/request ID. Liveness remains DB-independent.

`DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:57432/cashmemo_e2e cargo test -p cashmemo-api --test operations --test migrations --test http_safety`

Result: 34 passed (`http_safety` 12, `migrations` 9, `operations` 13).

## Read-only proof

Every readiness test snapshots public table names, public column schema, and migration version,
success, and checksum before/after request. Snapshots stay exactly equal. Validator contains only
target-guard SELECT queries: no advisory lock, metadata initialization/insert, migration, repair,
or business query.

## Cleanup

Used only Docker Compose project `cashmemo-pr3-task8`, postgres service, port `57432`.
Final cleanup: `docker-compose -p cashmemo-pr3-task8 -f infra/v1/test-compose.yml down --volumes --remove-orphans`.

## Changed files

- `apps/api/src/db/readiness.rs`
- `apps/api/src/db/mod.rs`
- `apps/api/src/db/target_guard.rs`
- `apps/api/src/app.rs`
- `apps/api/tests/operations.rs`
- `apps/api/tests/migrations.rs`
- `docs/verification/v1-pr3-repair-evidence.md`
- `.superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-8-report.md`

## Self-review

Checked formatter, diff whitespace, scoped diff, full required test command, canonical error ID,
V1 migration 9 checksum, liveness independence, and read-only snapshots. No generated export,
production/Dokploy mutation, push, or merge.

## Commit

Signed commit subject: `fix: verify V1 migration state in readiness`.
