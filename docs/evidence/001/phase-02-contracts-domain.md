# Phase 2 Contracts and Domain Evidence

- Date: 2026-08-01
- Owner: Backend feature owner
- Scope: T016–T037
- Appwrite environment: isolated self-hosted Appwrite 1.9.6 on Colima arm64, official Compose
  services, MongoDB adapter owned only by Appwrite
- Appwrite application access: REST and GraphQL at `http://localhost:8080/v1`; no Cashmemo
  MongoDB driver, credential, command, or connection
- Provisioning identity: isolated `cashmemo-test` project with a runtime-only API key scoped to
  required Appwrite server APIs; secret values are excluded from this evidence

## Commands and results

| Command | Result |
|---|---|
| `npm run format` | PASS; implementation/config files formatted, authoritative specs/docs ignored |
| `just contracts` | PASS; OpenAPI semantics, export JSON Schema 2020-12, generated TypeScript drift, and Redocly lint |
| `node --test tests/contracts/currency_registry.test.mjs` | PASS; 2 tests |
| `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` | PASS |
| `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets --all-features -- -D warnings` | PASS |
| `cargo test --manifest-path backend/Cargo.toml --workspace --all-targets` | PASS; 14 domain/HTTP contract tests |
| `just architecture-check` | PASS; repository boundary plus domain outward-dependency test |
| `npm exec -- tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --types node infra/appwrite/provision.ts` | PASS |
| `npm exec -- tsx infra/appwrite/provision.ts` with isolated runtime credentials | PASS; schema provisioned through supported TablesDB REST APIs |
| `cargo test --manifest-path tests/integration-appwrite/Cargo.toml --test schema_contract -- --nocapture` with isolated runtime credentials | PASS; 2 real-Appwrite tests |

## Real Appwrite assertions

- Health API returned Appwrite `1.9.6`.
- Provisioning was idempotent and waited for every asynchronous column and index to become
  `available`.
- The real tables contain every checked-in column and index for `money_memos`, `labels`, and
  `user_journal_state`; no extra or missing key was accepted.
- All three tables have empty table permissions and `rowSecurity=false`, keeping rows private to
  the scoped backend credential.
- Every table remains below the approved twenty-custom-index limit.
- A supported TablesDB transaction was created successfully.
- A supported GraphQL POST list accepted body variables and `ttl=0`, avoiding content-bearing URL
  queries and Appwrite's non-invalidating list cache.
- The capability test initially rejected an incorrect REST `POST /rows` assumption. It now tests
  the documented GraphQL `tablesDBListRows` operation; no unsupported API behavior is claimed.

## Contract and boundary assertions

- OpenAPI and export schemas enforce canonical six-digit UTC instants, exact offset bounds,
  lifecycle-dependent required-nullable `purgeDeadline`, exact currency scale, stable privacy
  error codes, and closed object shapes.
- Generated TypeScript and reviewed Rust DTO boundaries contain no client owner field.
- Money, occurrence, lifecycle, identifiers, labels, privacy outcomes, and aggregate invariants
  live in the dependency-free domain crate.
- Architecture tests reject Axum, Appwrite, persistence, browser, telemetry, AI/STT, Redis, and
  MongoDB dependencies from the domain crate.
- Detector outcome types carry only published safe identifiers. Candidate text and derivatives
  have no domain or HTTP diagnostic field.

Phase 3 owns real session and cross-user behavior. Phase 4 owns creation fingerprint,
idempotency, Pattern Set execution, and US1 acceptance evidence.
