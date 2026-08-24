# Cashmemo V1 acceptance evidence

Status: **PASS** for current repository acceptance gates. This record covers only disposable local
V1 services; it is not deployment or production evidence.

Recorded: `2026-08-25T02:18:49+0700 WIB`.

Verification source commit: `0dcc7aa9c45cb9921077f5dc6e090ad33950af69`. Host/toolchain: macOS
`Darwin 25.6.0 arm64`; Rust `rustc 1.95.0`, Cargo `1.95.0`; pnpm `11.13.1`; installed Node
`v24.14.0` used for final E2E retry. Initial clean gate inherited Node `v22.19.0`, which pnpm
correctly warned does not meet required `24.14.0`.

## Clean local gate

Disposable `postgres` and `mailpit` from `infra/v1/test-compose.yml` were started with standalone
Docker Compose `5.3.1` (this host has no `docker compose` plugin). They use only `cashmemo_e2e`
credentials on `127.0.0.1:54329` and Mailpit on `127.0.0.1:1025/8025`.

```sh
pnpm install --frozen-lockfile && cargo clean && pnpm v1:verify && pnpm --dir v1/web playwright test
```

Results:

- `pnpm install --frozen-lockfile`: passed; lockfile unchanged. pnpm emitted Node-22 engine warning.
- `cargo clean`: passed; removed `63,311` build files (`14.5GiB`). This was authorized build-cache
  cleanup only.
- `pnpm v1:verify`: passed: locked Rust OpenAPI + Orval drift check, Rustfmt, warning-as-error
  Clippy, full V1 Rust suite, V1 web lint, typecheck, Vitest, and Next build.
- Literal final command is not a valid pnpm invocation here: it returned
  `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "v1/web" not found` (`exit=1`). The supported
  equivalent is `pnpm --dir v1/web exec playwright test`; no failure was suppressed.

The first equivalent attempt correctly stopped before tests because SQLx metadata made the shared
test target non-empty: `migration target contains unknown tables`. The harness was then reset only
with:

```sh
docker-compose -f infra/v1/test-compose.yml down --volumes
docker-compose -f infra/v1/test-compose.yml up -d --wait postgres mailpit
```

This reset removed only Task-23 disposable Compose containers/network/volumes.

## Browser acceptance

```sh
PATH=/Users/andresholivin/.nvm/versions/node/v24.14.0/bin:$PATH \
  pnpm --dir v1/web exec playwright test
```

Initial four-worker run failed at post-deletion login. Trace shows this was not rate limiting:
`POST /api/v1/auth/login` returned `200` after roughly `10.06s`, after prior `10s` Playwright
expectation elapsed. Parallel Argon2 work delayed legitimate response.

E2E harness now explicitly supplies bounded `100` auth attempts only to child API process;
production defaults/configuration unchanged. Regression test proves parent environment is not
mutated. E2E expectation timeout is `30s`, below per-test `60s` timeout. Existing Rust `http_safety`
test still proves normal rate limiting returns `429` after six attempts.

Two fresh disposable-harness retries with default six flows/four workers passed under Node
`v24.14.0`; neither used worker-count workaround. Full V1 web regression passed: `15` Vitest files /
`84` tests, TypeScript, lint, deterministic OpenAPI/client drift.

`next start` still prints standalone-output warning. It did not prevent API migration/serve or
either full browser run, but should remain visible in follow-up verification.

## Immutable repository inputs

All SHA-256 values are content checksums at source commit `0dcc7aa`.

| Artifact                                              | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `openapi/cashmemo-v1.json`                            | `6d3511058d1907e65aa32802bbacdff4d356e71bd749dc588f3069b3115584b8` |
| `v1/web/generated/api` deterministic file-tree digest | `ed53f6d2624deef4db0666209a0476123132e2ccbbeb2ea8b4b96d1549a8b9d2` |
| `v1/api/migrations` deterministic SQL-tree digest     | `a9f332788eb326bc245d22f172191cec76f8faa49ee1be2746d838ea20b110b4` |
| `.github/workflows/v1-ci.yml`                         | `e0b75a79fe7c6e77bf4c0063312cb05d4ced1f59c9e6961ab7d2debe1cd1a0b9` |
| `infra/v1/api.Dockerfile`                             | `8d5dacb8e96fe0b40e1772268cefb1355304a1215cd7cd8a03ec2efeb0335536` |
| `infra/v1/web.Dockerfile`                             | `5527dad60ee2722a331c0369788b3c64212d1e10992e6500456f20ff2ff9a5e0` |
| `infra/v1/dokploy-compose.yml`                        | `caab736bf3dd0607b9c7b8783cfd4998912457592048fa4235717807f108f527` |
| `infra/v1/test-compose.yml`                           | `d7ccf441d86d5a937a758b79d97a37c7eb7b1e96f5107bf143d280d412eb6f7c` |
| `infra/v1/env.example`                                | `349e8e9ffecd4967c11f013de9c00a810fff2e7774a828fe98d698c778330bb7` |
| `infra/v1/traefik.md`                                 | `82d9dc300fba6d158092b4d7f44e8a39497df0de6d0109c027bd5ddce709a375` |

Evidence-document checksums are recorded after this documentation commit in ignored Task-23 report,
avoiding a self-referential checksum claim.
