# Cashmemo V1 rewrite

Cashmemo V1 is isolated, temporary Rust/Axum + Next.js rewrite under `v1/`.

Design and planned repository replacement:
[spec](docs/superpowers/specs/2026-08-21-cashmemo-v1-rebuild-design.md) and
[implementation plan](docs/superpowers/plans/2026-08-21-cashmemo-v1-rebuild.md).

Current verification records:

- [Acceptance evidence](docs/verification/v1-acceptance.md) — **NOT PASSING**: default parallel
  Playwright gate must be fixed/rerun.
- [Security/database audit](docs/verification/v1-security-audit.md) — named Rust audit binaries pass
  on disposable V1 PostgreSQL.
- [Merge readiness](docs/verification/v1-merge-readiness.md) — **NOT READY**: E2E, preservation,
  canonical-promotion, and legacy-removal criteria remain.
- [Production-cutover readiness](docs/verification/v1-production-readiness.md) — **NOT READY**: no
  production environment audit or action occurred.

These records do not authorize merge, production migration, deployment, route switching, or legacy
removal. See [preservation gate](docs/operations/preservation-gate.md) before later destructive or
production action.
