# Cashmemo V1 production-cutover readiness

Status: **NOT READY** as of `2026-08-25T02:18:49+0700 WIB`.

No actual Dokploy/production environment was inspected or changed for this task. Absent evidence is
not inferred from repository files. This record neither deploys nor approves deployment, production
migration, route change, or legacy retirement.

| Required cutover input                                      | Repository evidence                                         | Production evidence / state                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Actual environment and data inventory                       | Preservation gate defines target-bound signed evidence.     | **NOT RECORDED**; local `ops/evidence/external/dokploy-environment.json` is `BLOCKED_EXTERNAL`, `approved: false`.         |
| Real-data decision and migration spec/plan/result           | Clean V1 schema and fail-closed target guard exist.         | **NOT RECORDED**; no migration may proceed. Real data requires approved plan and `STOP_REQUIRES_DEDICATED_MIGRATION_PLAN`. |
| Recent usable backup and verified isolated restore          | Backup/recovery and restore runbooks exist.                 | **NOT RECORDED**.                                                                                                          |
| Deployment config and immutable V1 image digests            | `infra/v1/dokploy-compose.yml` and env example versioned.   | **NOT RECORDED**. Local image/build hashes are never deployed/registry digest evidence.                                    |
| Existing legacy image/config digest and runtime state       | Rollback runbook requires retention.                        | **NOT RECORDED**.                                                                                                          |
| Prepared V1 production DB and one-shot migrate result       | API documents explicit `migrate`; startup does not migrate. | **NOT RECORDED**.                                                                                                          |
| Post-deploy health/smoke, rollback/reconciliation procedure | Deployment and rollback runbooks define process.            | **NOT EXECUTED / NOT RECORDED**.                                                                                           |
| Named operator approval                                     | Cutover template exists.                                    | **NOT RECORDED**.                                                                                                          |

Before later cutover, operator must produce target-bound preservation, backup, restore,
deployment-digest, migration, smoke, rollback/reconciliation, and approval evidence outside repo;
then follow [preservation gate](../operations/preservation-gate.md),
[deployment runbook](../operations/v1-deployment.md), and
[rollback runbook](../operations/rollback.md).

Container-definition checksums at source `0dcc7aa`:

- API Dockerfile: `8d5dacb8e96fe0b40e1772268cefb1355304a1215cd7cd8a03ec2efeb0335536`
- Web Dockerfile: `5527dad60ee2722a331c0369788b3c64212d1e10992e6500456f20ff2ff9a5e0`
- Dokploy Compose: `caab736bf3dd0607b9c7b8783cfd4998912457592048fa4235717807f108f527`
