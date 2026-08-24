# Cashmemo V1

Cashmemo V1 is current Cashmemo application: Rust/Axum API under `apps/api` and Next.js App Router
web client under `apps/web`. PostgreSQL is authoritative persistence; Rust OpenAPI generates Orval
types, Axios transport, and TanStack Query hooks for web client.

Design and planned repository replacement:
[spec](docs/superpowers/specs/2026-08-21-cashmemo-v1-rebuild-design.md) and
[implementation plan](docs/superpowers/plans/2026-08-21-cashmemo-v1-rebuild.md).

Current verification records:

- [Acceptance evidence](docs/verification/v1-acceptance.md) — current clean/default V1 checks pass
  on disposable services.
- [Security/database audit](docs/verification/v1-security-audit.md) — named Rust audit binaries pass
  on disposable V1 PostgreSQL.
- [Merge readiness](docs/verification/v1-merge-readiness.md) — Task 26 records final branch review;
  current production preservation decision remains unresolved.
- [Production-cutover readiness](docs/verification/v1-production-readiness.md) — **NOT READY**: no
  production environment audit or action occurred.

Legacy runtime code is removed. Reviewed legacy migration/history evidence remains under
`apps/server/src/adapters/postgres/migrations` while external data audit is unresolved. Repository
replacement does not authorize merge, production migration, deployment, route switching, legacy data
destruction, or infrastructure retirement. See
[preservation gate](docs/operations/preservation-gate.md) before later destructive or production
action.

Canonical local checks:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm --dir apps/web exec playwright test
bats tests/repository/canonical-layout.bats
```
