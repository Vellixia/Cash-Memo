# Cashmemo V1 final branch review

## Task 25 final evidence — implementation head `76a8a53`

Recorded: `2026-08-31` WIB. Current implementation head is `76a8a53`, parent
`3291391`; config-only Playwright serialization change. Full parent verification matrix passed:
install/verify `181/181`, operations `2/2`, Bats `44/44`, migrations `9/9`, S3 replay `8/8`, release
build, audit, API direct Trivy `0`, and web runtime contract. Exact default Playwright then passed
`15/15` twice after the deterministic worker change. Lint, typecheck, and `git diff --check` passed.

Controlled four-worker (`9/15`) and two-worker (`14/15`) runs established resource contention on
the disposable 2-vCPU/4-GiB stack; `workers: 1` makes default execution deterministic. No timeout,
retry, or product changes were made. Scoped Cargo cleanup removed `19.3 GiB` generated `target`
output to resolve `ENOSPC`; no source or user data was removed.

Direct local web-image Trivy remains **NOT GREEN**: Docker `29.5.2` containerd export emits an
incomplete archive before vulnerability analysis. Unchanged flattened merged-rootfs diagnostic
(`CRITICAL,HIGH`, `--ignore-unfixed`, `os,library`) found `0`, but is diagnostic only. Hosted direct
web-image Trivy remains mandatory. Repository ruling: **REQUEST CHANGES / NOT MERGE READY** pending
Task 26 hosted CI/direct scan and exact main-integration review. Production remains **NOT READY**;
no production evidence or action occurred.

Prior failed attempts below are superseded diagnostics; only direct local Trivy remains current
blocker.

## Task 25 final fresh local verification — supersedes prior Task 25 summaries

Recorded: `2026-08-31T12:56:21+0700 WIB` (`Asia/Jakarta`, WIB). Implementation under test:
`32913913267ec7ad8fd414dae2bd4f411f0778e7` on `rewrite/cashmemo-v1`.

**Current local verdict: BLOCKED.** This section supersedes the earlier Task 25 status blocks
below; they remain historical forensic evidence, not current gate results. Pinned execution used
Node `24.14.0`, pnpm `11.13.1`, Rust/Cargo `1.97.1`, Docker client `29.7.1` / server `29.5.2`,
Docker Compose `5.3.1`, and Trivy `0.74.0`.

- PASS: frozen install; second exact `pnpm verify` (`181/181` web tests); operations `2/2`; Bats
  `44/44`; migrations `9/9`; S3 replay `8/8`; release S3 build; production dependency audit;
  API image/Trivy (`0` findings); web image/runtime contract; and final scoped `git diff --check`.
- Playwright evidence is mixed: default four-worker run reached `13/15`, with two 60-second E2E
  timeouts; clean serial diagnostic passed `15/15`. A final clean default rerun was blocked before
  tests by host `ENOSPC` while Next wrote `.next/required-server-files.json` (only `740 MiB` free).
  No cache, image, worktree, or unknown Docker-project cleanup was authorized.
- Required direct web-image Trivy remains **NOT GREEN**: it failed before vulnerability analysis
  because Docker's local archive lacked `blobs/sha256/f9be01e39433b9e8b3a23690f760b5a8f7056934b6857841c2a7d8c27ffa5e29`.
  Exact-policy flattened merged-rootfs diagnostic returned zero findings, but is not a substitute.
  Task 26 hosted direct-image scan on exact final integration result remains mandatory.

No signed evidence commit was created. Protected `.claude/settings.json`, `.serena/`, `AGENTS.md`,
and `CLAUDE.md` were untouched; both the named `cashmemo-pr3-task25` and repository-default `v1`
disposable Compose projects were removed.

## Superseding Task 25 local rerun

Recorded: `2026-08-30T02:56:18+0700 WIB` (`Asia/Jakarta`, WIB).

Current implementation under test: `d733b13dd7fd`.

Current verdict from fresh local evidence:

- Repository branch: **NOT CURRENTLY MERGE READY FROM LOCAL GATES**.
- Merge action: **NOT PERFORMED**.
- Production cutover: **NOT READY**.
- Production/Dokploy access or mutation: **NOT PERFORMED**.

Task 25 reran the required local verification with pinned Node `24.14.0`, pnpm `11.13.1`,
Cargo/Rust `1.97.1`, Docker Compose `5.3.1`, and Trivy `0.74.0`. `pnpm verify`,
`pnpm test:operations`, repository and operations Bats, migration and feature-enabled S3 replay,
dependency audit, API image build/scan, and web runtime contract all passed. Two required local
gates remain unresolved:

- `pnpm --dir apps/web exec playwright test` failed on a clean disposable `v1` stack with `10`
  passing and `5` failing tests.
- `trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 --pkg-types os,library cashmemo-v1-web:task25`
  failed during scanner layer analysis, so no web-image vulnerability verdict exists yet.

Protected user-owned paths remained untouched: modified tracked `.claude/settings.json`, plus
untracked `.serena/`, `AGENTS.md`, and `CLAUDE.md`. No signed evidence commit was created because
required local gates did not all pass. The remainder of this document preserves the earlier
`2026-08-25` review as historical context only; use
[v1-pr3-repair-evidence](v1-pr3-repair-evidence.md) for the fresh Task 25 command record.

Recorded: `2026-08-25T05:18:02+0700 WIB` (`Asia/Jakarta`, WIB).

Implementation under test: `b2c89dcbe429100ef2bc700cf2bef9fe26bd1c17`.

Branch: `rewrite/cashmemo-v1`. Comparison: `new-cashmemo` at
`c428e2dd334fcfbcb4e63d421919282a55227845`; observed merge base is the same commit. Any later
documentation-only commit records this evidence and is not the implementation under test.

## Verdict

- Repository branch: **MERGE READY FOR HUMAN REVIEW**.
- Merge action: **NOT PERFORMED**.
- Production cutover: **NOT READY**.
- Production/Dokploy access or mutation: **NOT PERFORMED**.

Repository merge is safe to review because the canonical replacement and preserved history coexist
without any production database action. Production replacement remains blocked by target-bound
audit, backup/restore, deployment, rollback, and operator-approval evidence.

## Final-review findings and repairs

Initial range verification found whitespace errors already committed across the rewrite branch.
Commit `d9171ec5ece554d584e16144e7dd88c83bb85fff` removes only extra terminal lines and
design-header trailing spaces. Orval's supported `afterAllFilesWrite` function now normalizes only
generated `apps/web/generated/api/index.ts` line endings; two consecutive generation results were
identical, and OpenAPI/client drift passed.

Stale-reference review then found root `eslint.config.mjs` targeting two deleted legacy integration
tests. After those blocks were removed, direct execution proved the root config could not resolve
its dependencies; canonical web already owns runnable `apps/web/eslint.config.mjs`. TDD first added
a failing path-pinned canonical assertion, then commit `b2c89dcbe429100ef2bc700cf2bef9fe26bd1c17`
removed the obsolete root config. The reviewed Task-24 manifest remains byte-identical and
historical: its single `ALREADY_REUSED eslint.config.mjs` classification is superseded only by this
exact final-audit decision. Cost if this ruling is wrong: one generic root lint configuration would
need restoration with explicit dependency ownership; V1 web lint remains independently owned and
verified.

The pre-apply helper `scripts/apply-approved-legacy-removal.sh --check` correctly reports
`LEGACY_REMOVAL_MANIFEST_INCOMPLETE` after canonical removal. Post-apply repository Bats, not that
pre-apply helper, are the final-state authority.

## Fresh verification evidence

All application and recovery services below were disposable local V1 services. They were removed
after tests; ports `3000`, `3001`, `54329`, `54330`, `8025`, and `9000` had no listeners. Colima was
left running.

| Gate                                                                                        | Fresh result                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git diff --check new-cashmemo...HEAD`                                                      | PASS after scoped repair; no branch-range whitespace errors.                                                                                                                         |
| `pnpm verify`                                                                               | PASS on final tree: deterministic OpenAPI/Orval, Rust format, Clippy with warnings denied, 116/116 Rust tests, web lint/typecheck, 84/84 Vitest tests, and Next.js production build. |
| `pnpm --dir apps/web exec playwright test`                                                  | PASS 6/6 using default four workers against fresh PostgreSQL and Mailpit; registration used delivered verification email.                                                            |
| `bats tests/repository/canonical-layout.bats tests/repository/legacy-removal-manifest.bats` | PASS 22/22 after final root-config removal.                                                                                                                                          |
| `bats tests/operations/*.bats`                                                              | PASS 17/17 for preservation, production replacement, restore, and receipt-replay wrappers.                                                                                           |
| `pnpm test:operations`                                                                      | PASS 2/2 CI workflow contract tests.                                                                                                                                                 |
| Focused Rust ownership/auth/account deletion/HTTP/migrations/money/recurrence               | PASS 59/59.                                                                                                                                                                          |
| Feature-enabled deletion receipt replay                                                     | PASS 5/5 against disposable restored PostgreSQL and MinIO, including fail-closed malformed data and idempotent multi-key replay.                                                     |
| `pnpm --dir apps/web audit --prod --audit-level high`                                       | PASS; no known production dependency vulnerabilities.                                                                                                                                |
| `bash infra/v1/test-dokploy-compose.sh`                                                     | PASS; `Compose contract PASS`. No production deployment occurred.                                                                                                                    |
| Toolchain contract                                                                          | PASS: Node `24.14.0`, pnpm `11.13.1`, Rust/Cargo `1.95.0`, Bats `1.14.0`.                                                                                                            |
| Stale executable reference scan                                                             | PASS for current workspace, CI, app, Docker, and contract-generation surfaces.                                                                                                       |

One exploratory toolchain invocation used shell-default Node `22.19.0` and correctly failed its pin
check; rerunning with the repository's Node `24.14.0` passed. This was an environment invocation
error, not an application failure.

## Canonical and preservation audit

- Canonical tracked files: 82 under `apps/api`, 172 under `apps/web`.
- Temporary `v1/` application tree is absent.
- Executable legacy app/packages/routes/workflows are absent.
- Reviewed manifest identity: `bfcec955cfa58e323312fa8e7250806f1a2354ae28dcbda90d5d9fccdad85d31`.
- Inventory remains 388 `REMOVE`, 44 `PRESERVE`, 67 `ALREADY_REUSED` records.
- Repository tests prove 386 removal paths absent. `apps/web/package.json` and
  `apps/web/tsconfig.json` are the two approved canonical destination collisions and contain
  validated non-legacy V1 replacements. All 44 preserved blobs remain byte-identical to reviewed
  base `b2d462eacc0307080aea68ce06dd2abc03058f8c`.
- Preserved legacy migration tree:
  `b298f2ed7874b1718a2f7f2f2cb88429170735bbe07806720a75d1ba7e57f462`.
- V1 migrations remain independent under `apps/api/migrations`; tree identity:
  `3cc8cdd407d4c871f4b25eae9d72711169d52792a0f3c7ac1a28aa20bb0e0cc6`.
- External evidence remains `BLOCKED_EXTERNAL`, `approved: false`; no actual data decision exists.
- If real user data is discovered, execution changes immediately to
  `STOP_REQUIRES_DEDICATED_MIGRATION_PLAN`.

## Security and correctness mapping

- Cross-user inference/access: ownership tests and browser cache-isolation flow.
- Exact money and no silent rounding: money tests, including pre-SQL excess-scale rejection.
- Multi-currency separation and reporting: full Rust budget/reporting/money suites.
- Timezone month and recurrence semantics: budget/reporting/recurrence suites.
- Trash, restore, purge, and occurrence survival: transaction and recurrence suites.
- Session revocation and deletion claim race: auth/account-deletion suites and browser flow.
- Unknown target protection: migration suite rejects unknown non-empty and invalid V1 histories.
- Recovery anti-resurrection: feature-enabled S3 receipt replay and fail-closed wrapper Bats.

## Review limitations

- Hosted GitHub Actions status was not accessed. Local review ran the required branch gates and
  focused workflow contracts; human PR review must still require appropriate hosted status checks.
- No production environment, Dokploy project, production database, backup repository, registry
  digest, route, or operator approval was inspected.
- Local disposable backup/replay evidence proves repository capability only, not actual production
  backup freshness or recoverability.
- `.serena/` is user-owned, untracked, and intentionally untouched. Tracked-tree cleanliness is
  reported separately.

## Handoff

Human may review `rewrite/cashmemo-v1` for merge. Merge, deployment, production migration, route
cutover, rollback, and operational cleanup each remain outside this review and require their own
authorization and gates.
