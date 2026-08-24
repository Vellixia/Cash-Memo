# Cashmemo V1 production-cutover readiness

Status: **NOT READY** as of `2026-08-25T05:18:02+0700 WIB`.

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
