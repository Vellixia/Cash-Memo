# Cashmemo V1 CI gates

`.github/workflows/v1-ci.yml` protects isolated Cashmemo V1 work. It has read-only GitHub token
permissions, cancels superseded runs for same ref, and uses pinned checkout, Node, cache, and
scanner actions. It does not deploy, contact Dokploy, route traffic, or use production or legacy
database credentials.

## Required checks

- **Rust** runs formatting, warning-as-error Clippy, unit tests, PostgreSQL integration tests, and
  feature-enabled release build. PostgreSQL service uses disposable `cashmemo_v1_ci` credentials.
- **Frontend** runs V1 lint, TypeScript, Vitest, and Next build.
- **OpenAPI** regenerates Rust OpenAPI plus Orval client and rejects Git drift.
- **Migration safety** runs real PostgreSQL migration-target tests. Empty and identified V1 targets
  are allowed; unknown non-empty targets, malformed histories, gaps, and modified checksums fail.
- **Playwright** runs six Chromium flows against real Next, Rust, PostgreSQL, and Mailpit. The
  harness starts `postgres` and `mailpit` from `infra/v1/test-compose.yml`, creates unique recipient
  addresses, and completes delivered email verification. No verification bypass is set.
- **Recovery safety** runs feature-enabled deletion-receipt replay tests and fail-closed Bats gates
  for preservation, production-replacement, restore, and replay wrappers. These use disposable test
  evidence only; API serve receives no backup or receipt-recovery credentials.
- **Docker and security** build V1 API and web images, scan both images for high/critical fixed
  vulnerabilities, and audit V1 web production dependencies. These are focused checks; existing
  legacy security workflows remain independent and are not a V1 quality gate.

## Local gate

`v1:verify` is intentionally strict: it generates/checks OpenAPI and Orval output, formats and
Clippy-checks Rust, runs every Rust test, then runs V1 frontend lint/typecheck/Vitest/build. Rust
integration tests require a disposable PostgreSQL target. Start only test PostgreSQL first, then run
gate:

```sh
docker compose -f infra/v1/test-compose.yml up -d --wait postgres
DATABASE_URL=postgres://cashmemo_e2e:cashmemo_e2e@127.0.0.1:54329/cashmemo_e2e pnpm v1:verify
docker compose -f infra/v1/test-compose.yml down --volumes
pnpm --dir v1/web exec playwright test
```

If local Docker provides standalone Compose rather than plugin, replace `docker compose` with
`docker-compose`; GitHub Ubuntu runners use Docker Compose plugin. The reset separates SQLx test
metadata from Playwright's migration target, preserving its unknown-nonempty fail-closed contract.
Stop disposable services when finished:

```sh
docker compose -f infra/v1/test-compose.yml down --volumes
```

Validate Dokploy Compose separately with disposable values only; never supply live credentials to CI
or local CI verification:

```sh
infra/v1/test-dokploy-compose.sh
```
