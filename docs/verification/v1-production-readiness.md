# Cashmemo V1 production-cutover readiness

## Task 25 final evidence — implementation head `76a8a53`

Status remains **NOT READY**. Head `76a8a53`, parent `3291391`; config-only Playwright serialization.
Full parent matrix passed install/verify `181/181`, operations `2/2`, Bats `44/44`, migrations `9/9`,
S3 replay `8/8`, release build, audit, API direct Trivy `0`, and web runtime contract. Exact default
Playwright passed `15/15` twice with deterministic `workers: 1`; controlled four-worker `9/15` and
two-worker `14/15` runs established resource contention. Lint, typecheck, and `git diff --check`
passed. No timeout, retry, or product changes were made.

Scoped Cargo cleanup removed `19.3 GiB` generated `target` output for `ENOSPC`; no source or user
data was removed. Direct local web-image Trivy remains **NOT GREEN** due to Docker `29.5.2`
containerd incomplete archive before verdict; flattened merged-rootfs `0` is diagnostic only.
Hosted direct web-image Trivy remains mandatory. No production evidence or action occurred.
Prior failures are superseded diagnostics.

## Task 25 final local evidence update

Recorded: `2026-08-31T12:57:16+0700 WIB`. Status remains **NOT READY**. This supersedes prior
Task 25 summary for current local evidence while retaining it as historical traceability.

At `32913913267ec7ad8fd414dae2bd4f411f0778e7`, fresh pinned-toolchain evidence passed frozen
install, final `pnpm verify` (`181/181`), operations `2/2`, Bats `44/44`, migrations `9/9`,
feature-enabled isolated S3 replay `8/8`, release build, dependency audit, API build/direct Trivy,
and web build/runtime contract. The disposable named `cashmemo-pr3-task25` project used PostgreSQL
`55429`, restored PostgreSQL `55430`, and MinIO `32769`; it was removed after the gates.

This does not establish a release candidate: default four-worker Playwright had two 60-second
timeouts (`13/15`), serial diagnosis passed `15/15`, and final default retry then hit host `ENOSPC`
before tests. Direct local web Trivy also remains fail-closed before a vulnerability verdict due to
a missing Docker archive blob; flattened rootfs zero-findings scan is diagnostic only. Hosted direct
web Trivy on exact final integration result remains required. These local results still prove no
production backup, receipt store, retained-backup restore replay, deployment artifact, target,
cutover, rollback, or operator approval.

Status: **NOT READY** as of `2026-08-25T05:18:02+0700 WIB`.

## Task 25 local rerun update

Recorded: `2026-08-30T02:56:18+0700 WIB` (`Asia/Jakarta`, WIB).

Fresh local verification at `d733b13dd7fd` did not change production status. It did add current
local evidence:

- Local disposable recovery mechanism still works: fresh named project `cashmemo-pr3-task25`,
  isolated restored PostgreSQL at `127.0.0.1:55430`, and disposable MinIO replay at
  `127.0.0.1:32769` passed feature-enabled `deletion_receipt_replay` `8/8`.
- Local disposable application and repository gates mostly passed: `pnpm verify`,
  `pnpm test:operations`, repository/operations Bats `44/44`, migration tests `9/9`,
  dependency audit, API image build/scan, and web runtime contract.
- Required local verification is still not green because clean Playwright E2E failed `5/15`, and
  the required web-image Trivy command aborted during tar-layer analysis before producing any
  vulnerability verdict.
- Final cleanup removed the exact named disposable project. `docker-compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml ps -a`
  returned only the header row.

This still proves mechanism only. It does not prove any actual production backup, receipt store,
restore rehearsal, deployment artifact, deployment target, cutover sequence, rollback route, or
operator approval. Local MinIO and disposable restored PostgreSQL remain insufficient substitutes
for production-target evidence.

Repository implementation reviewed: `b2c89dcbe429100ef2bc700cf2bef9fe26bd1c17`. Repository merge
readiness is recorded separately in [v1-merge-readiness.md](v1-merge-readiness.md). No actual
Dokploy or production environment was accessed, inspected, or changed during final branch review.
Repository files cannot substitute for target-bound production evidence.

| Required cutover input                                 | Repository capability                                                            | Production evidence / state                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Actual environment and data inventory                  | Preservation gate supports signed, target-bound evidence.                        | **NOT RECORDED**. Local `ops/evidence/external/dokploy-environment.json` is `BLOCKED_EXTERNAL`, `approved: false`, with no data decision. |
| Real-data decision and migration                       | Clean V1 schema and fail-closed target guard exist.                              | **NOT RECORDED**. Discovery of real user data requires `STOP_REQUIRES_DEDICATED_MIGRATION_PLAN`.                                          |
| Recent usable backup                                   | pgBackRest requirements and external encrypted repository design are documented. | **NOT RECORDED** for the actual target.                                                                                                   |
| Isolated restore and deletion-receipt replay           | Disposable recovery tests and scripts pass locally.                              | **NOT EXECUTED** against an actual retained production backup.                                                                            |
| Deployment configuration and immutable image digests   | Canonical Dockerfiles and Dokploy Compose are versioned.                         | **NOT RECORDED** for production. Local source/image evidence is not a registry digest or deployment record.                               |
| Recoverable legacy image/config/routing/database state | Rollback runbook requires preservation.                                          | **NOT RECORDED**.                                                                                                                         |
| Prepared V1 production database and migration result   | Explicit one-shot migration command exists; API startup does not migrate.        | **NOT EXECUTED / NOT RECORDED**.                                                                                                          |
| Smoke and rollback/reconciliation readiness            | Versioned deployment and rollback procedures exist.                              | **NOT EXECUTED / NOT RECORDED**. If V1 accepts writes, rollback cannot route silently to stale legacy data.                               |
| Named operator approval                                | Approval template exists.                                                        | **NOT RECORDED**.                                                                                                                         |

Production replacement remains blocked until a named operator supplies and verifies every missing
input above. Isolated development/staging deployments using explicitly disposable V1 databases do
not require the legacy production-data audit; destructive legacy-data action, production-target
migration, production replacement deployment, and production route cutover do.

Later operator sequence:

1. Follow the [preservation gate](../operations/preservation-gate.md) against the actual target.
2. Stop and create a dedicated migration specification and plan if real user data is found.
3. Verify a recent backup and isolated restore, including deletion-receipt replay.
4. Record legacy runtime state, V1 image digests, production database preparation, and approval.
5. Execute the [deployment runbook](../operations/v1-deployment.md) and
   [rollback/reconciliation runbook](../operations/rollback.md) only under separate authorization.

Backup copies expire according to configured pgBackRest retention relationships, not immediately
when live account data is purged. Any restored database stays isolated until deletion-receipt replay
completes.

This record authorizes no deployment, production migration, route switch, rollback, or
infrastructure retirement.
