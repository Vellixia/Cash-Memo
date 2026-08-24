# Cashmemo V1 merge readiness

Status: **MERGE READY FOR HUMAN REVIEW** as of `2026-08-25T05:18:02+0700 WIB`.

Implementation reviewed: `b2c89dcbe429100ef2bc700cf2bef9fe26bd1c17` on `rewrite/cashmemo-v1`.
Comparison branch and merge base: `new-cashmemo` at `c428e2dd334fcfbcb4e63d421919282a55227845`.

This status means repository replacement gates pass. It does not mean merged, deployed, or ready for
production cutover. See [production-cutover readiness](v1-production-readiness.md) and the
[final review](v1-final-review.md).

| Criterion                                  | Evidence                                                                                                                                                                                                                                                                                          | State |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Approved V1 scope                          | Canonical Rust API and Next.js app implement the approved manual financial-journal scope; excluded legacy/non-goal packages and routes are absent.                                                                                                                                                | PASS  |
| Local CI-equivalent gates                  | `pnpm verify` passed at the reviewed tree: OpenAPI/Orval drift, Rust format/Clippy, 116 Rust tests, web lint/typecheck, 84 Vitest tests, and production build.                                                                                                                                    | PASS  |
| Critical E2E                               | Fresh disposable PostgreSQL/Mailpit stack; Playwright passed 6/6 flows using default four workers.                                                                                                                                                                                                | PASS  |
| Ownership and security                     | Focused ownership, auth, account-deletion, HTTP-safety, migration, money, and recurrence run passed 59/59; full Rust suite also passed.                                                                                                                                                           | PASS  |
| Clean schema and target protection         | Migration integration tests passed 8/8, including refusal of unknown non-empty, modified, and gapped targets.                                                                                                                                                                                     | PASS  |
| Recovery safety                            | Real feature-enabled receipt replay passed 5/5 against disposable restored PostgreSQL and MinIO; operations Bats passed 17/17.                                                                                                                                                                    | PASS  |
| Canonical repository                       | `apps/api` and `apps/web` are canonical; temporary `v1/`, executable legacy roots, stale legacy commands, and obsolete root lint configuration are absent.                                                                                                                                        | PASS  |
| Exact legacy disposition                   | Reviewed manifest remains SHA-256 `bfcec955cfa58e323312fa8e7250806f1a2354ae28dcbda90d5d9fccdad85d31`; 386 `REMOVE` paths are absent, while the two canonical destination collisions contain validated non-legacy V1 replacements. All 44 `PRESERVE` blobs remain byte-identical to reviewed base. | PASS  |
| Preservation decision sufficient for merge | External audit remains unresolved, so all reviewed migration/history evidence is retained and production replacement remains fail-closed. Repository merge does not destroy or migrate legacy data.                                                                                               | PASS  |
| Documentation and final review             | Acceptance, security, operations, production-readiness, and final-review records are current and separate repository merge from production cutover.                                                                                                                                               | PASS  |
| Branch hygiene                             | `git diff --check new-cashmemo...HEAD` passed; 73 commits in comparison range had good signatures; tracked tree was clean. `.serena/` remained sole known untracked user-owned path.                                                                                                              | PASS  |

Human merge review must still inspect the branch and require repository status checks appropriate to
the PR. Hosted GitHub Actions was not accessed from this local review; fresh local commands covered
the workflow's application, browser, recovery, repository, operations, and dependency contracts. No
production condition is inferred from local disposable evidence.

## Canonical source identities

- OpenAPI: `6d3511058d1907e65aa32802bbacdff4d356e71bd749dc588f3069b3115584b8`
- Generated client tree: `83d31c17769e87362ea9f7e059f8248ee13b27831408781f74fa99aa3e3fa591`
- V1 migration tree: `3cc8cdd407d4c871f4b25eae9d72711169d52792a0f3c7ac1a28aa20bb0e0cc6`
- Preserved legacy migration tree:
  `b298f2ed7874b1718a2f7f2f2cb88429170735bbe07806720a75d1ba7e57f462`
- CI workflow: `ab84da07e50f9d5501ae178c1de5c9148a52385af26aa0de710be02ec1c6dbe5`
- API Dockerfile: `971e214ab7ba57e4794e6cb2e3d6b64588b74fc4fa29b63be3b6901e59e095e0`
- Web Dockerfile: `2b297617d05a59e55ce1745f9c52075f95e7d1920d335b6ac3266fa53bc55661`
- Dokploy Compose: `caab736bf3dd0607b9c7b8783cfd4998912457592048fa4235717807f108f527`

No merge, deployment, production migration, route change, Dokploy access, infrastructure retirement,
or legacy-data action was performed.
