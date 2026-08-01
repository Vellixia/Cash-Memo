# Phase 1 Foundation Evidence

- Date: 2026-08-01
- Owner: Backend/Web feature owner
- Scope: T001–T015 only
- Environment: macOS 26.5.2 arm64; Node 24.14.0; npm 11.9.0; Rust 1.97.1;
  `just` 1.57.0; Docker CLI 29.7.1; Docker Compose 5.3.1
- Appwrite image pin: `appwrite/appwrite:1.9.6@sha256:3d4dfbb5f989e88eef9211dd3184f53d8502f41d0c173b8b651a369ed4578789`
  (linux/arm64 registry manifest)

## Commands and results

| Command | Result |
|---|---|
| `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` | PASS |
| `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets --all-features -- -D warnings` | PASS |
| `cargo test --manifest-path backend/Cargo.toml --workspace` | PASS; empty binary shell |
| `npm run format:check` | PASS |
| `npm run lint` | PASS; zero warnings |
| `npm run typecheck` | PASS; strict TypeScript |
| `npm run build` | PASS; Next.js production build and `/sw.js` bundle |
| `just secrets-scan` | PASS; no secret values emitted |
| `just architecture-check` | PASS; layout and forbidden dependency boundary |
| `docker compose -f infra/compose/docker-compose.yml config --quiet` with generated ignored secrets | PASS |

`scripts/secrets/dev-init.sh` created `config/local-secrets/cashmemo.env` with mode `0600` and
printed no values. Separate runtime key names exist for fingerprint KEK, cursor AEAD, purge token,
local user partition, cookie, Appwrite server access, suppression storage, and telemetry export.

## Artifact links

- Repository policy: `.gitignore`, `.dockerignore`, `deny.toml`, `rust-toolchain.toml`
- Gate surface: `justfile`, `.github/workflows/ci.yml`
- Runtime schema: `config/env.schema.json`
- Architecture/C-07: `README.md`, `docs/governance/c07-control-register.md`
- Web shell: `apps/web/src/app/`, `apps/web/next.config.ts`
- Local stack: `infra/compose/docker-compose.yml`, `infra/otel-collector/config.yaml`

Real Appwrite behavior is not claimed by this phase. T036/T037 own exact-stack schema evidence;
T050/T051/T056 own authentication and cross-user evidence.

