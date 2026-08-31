# Cashmemo V1 merge readiness

## Task 25 final ruling — implementation head `76a8a53`

Current implementation head: `76a8a53`; parent: `3291391` (config-only Playwright serialization).
Full parent matrix passed install/verify `181/181`, operations `2/2`, Bats `44/44`, migrations `9/9`,
S3 replay `8/8`, release build, audit, API direct Trivy `0`, and web runtime contract. Exact default
Playwright passed `15/15` twice after setting deterministic `workers: 1`; controlled four-worker
`9/15` and two-worker `14/15` runs established resource contention. Lint, typecheck, and
`git diff --check` passed. No timeout, retry, or product changes were made.

Scoped Cargo cleanup removed `19.3 GiB` generated `target` output for `ENOSPC`; no source or user
data was removed. Direct local web-image Trivy remains **NOT GREEN** because Docker `29.5.2`
containerd exporter emits an incomplete archive before verdict. Flattened merged-rootfs scan found
`0` under unchanged policy, diagnostic only; it does not replace direct scan.

Status: **REQUEST CHANGES / NOT MERGE READY** pending Task 26 hosted CI/direct web-image Trivy on
exact final integration result and exact main integration review. Production readiness is separate
and remains **NOT READY**. Prior failures below are superseded diagnostics.

## Final Task 25 fresh-local ruling — supersedes prior Task 25 update

As of `2026-08-31T12:57:16+0700 WIB`, implementation
`32913913267ec7ad8fd414dae2bd4f411f0778e7` is **NOT MERGE READY**. This new ruling supersedes,
but does not erase, the `2026-08-30` Task 25 failure record below.

Fresh pinned Node `24.14.0` / pnpm `11.13.1` / Rust `1.97.1` evidence passed all non-browser,
non-direct-web-Trivy repository, recovery, build, audit, API-image, and web-runtime gates. Exact
default four-worker Playwright did not finish green (`13/15`, two 60-second timeouts); its clean
serial diagnostic passed `15/15`, then a final clean default retry was blocked before tests by
`ENOSPC` writing `.next/required-server-files.json` with host free space at `740 MiB`.

Separately and decisively, direct web-tag Trivy failed before a vulnerability verdict because
Docker's local image archive omitted a required blob. The flattened merged-rootfs diagnostic had
zero findings under unchanged `CRITICAL,HIGH`, `--ignore-unfixed`, `os,library` policy, but remains
diagnostic only. Per Task 25 ledger ruling, merge readiness stays blocked unless Task 26 hosted
direct web Trivy passes on exact final integration result. No signed Task 25 evidence commit exists.

Final cleanup removed only `cashmemo-pr3-task25` and repository-default disposable `v1` Compose
projects. Protected `.claude/settings.json`, `.serena/`, `AGENTS.md`, and `CLAUDE.md` were preserved.

Status: **NOT CURRENTLY MERGE READY FROM LOCAL GATES** as of `2026-08-30T02:56:18+0700 WIB`.

Superseding Task 25 update: fresh local verification at `d733b13dd7fd` invalidated the earlier
`2026-08-25` merge-ready record. Current local evidence is mixed:

- PASS: `pnpm verify`, `pnpm test:operations`, `bats tests/operations/*.bats tests/repository/*.bats`,
  `cargo test --locked -p cashmemo-api --test migrations`, feature-enabled
  `deletion_receipt_replay`, `cargo build --locked --release -p cashmemo-api --features s3-receipts`,
  `pnpm --dir apps/web audit --prod --audit-level high`, API image build, API Trivy scan, web image
  build, and `bash infra/v1/test-web-image.sh cashmemo-v1-web:task25`.
- FAIL: `pnpm --dir apps/web exec playwright test` on a clean default `v1` stack (`10` passed,
  `5` failed).
- FAIL: `trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 --pkg-types os,library cashmemo-v1-web:task25`
  aborted during layer analysis with missing tar blob data, so there is still no clean web-image
  scan result.

Protected user-owned paths remained untouched: modified tracked `.claude/settings.json`, plus
untracked `.serena/`, `AGENTS.md`, and `CLAUDE.md`. Final `git diff --check` passed. Final
`docker-compose -p cashmemo-pr3-task25 -f infra/v1/test-compose.yml ps -a` returned only the
header row, confirming named Task 25 containers were removed. No signed evidence commit exists.

Historical `2026-08-25` merge-readiness record remains below for traceability only.

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
