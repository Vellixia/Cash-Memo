# Task 14 verification report

Status: DONE

## Delivered

- Added Rust-owned deterministic OpenAPI export through `utoipa` at
  `v1/api/src/openapi.rs` and `v1/api/src/bin/export_openapi.rs`.
- Frozen all current V1 route paths with stable operation IDs, including only
  `/api/v1/reports/budget-summary`, `/api/v1/health/live`, and `/api/v1/health/ready`.
- Published canonical `ErrorBody.fields`, `EntryDefaults.last_used_wallet_id`, and recurrence
  names `recurring-transactions`, `recurring_transactions`, `recurring_transaction_id`, and
  `recurring_occurrence_id`.
- Added checked-in `openapi/cashmemo-v1.json`, Orval config, credentials-enabled Axios mutator
  with canonical error normalization, and generated TanStack Query/Axios client under
  `v1/web/generated/api/`.
- Added `v1:openapi`, `v1:api:generate`, and reproducible `v1:api:check` scripts.

## Verification evidence

- Initial OpenAPI contract test failed before implementation with unresolved `openapi` module.
- `cargo test -p cashmemo-api --test openapi`: 1 passed.
- `cargo fmt --all -- --check`: pass.
- `cargo clippy -p cashmemo-api --all-targets --all-features -- -D warnings`: pass.
- `pnpm v1:api:generate`: pass; Orval generated 40 paths and all models/client hooks.
- `pnpm v1:api:check`: pass with no OpenAPI/generated-client drift.
- Generated client typecheck via strict `tsc --noEmit`: pass.

## Scope

No legacy route, data, routing, deployment, or production endpoint changed.

## P1 correction

- Replaced synthetic `void` operation metadata with concrete Rust request/query/response schemas.
- Added JSON request bodies, typed response content, canonical `ErrorEnvelope` error responses,
  path/query parameters, and route-appropriate `201`, `204`, `401`, `403`, `404`, `409`, `422`,
  `429`, `500`, and `503` statuses.
- Representative history, transaction-create, budget-create, and account-deletion assertions now
  fail if bodies, query filters, typed responses, or canonical errors drift.
- Orval output now has typed input/output hooks; only expected health/204 operations retain
  `customAxios<void>`, and no generated hook uses `TError = void`.

## P1 verification

- `cargo test -p cashmemo-api --test openapi`: 2 passed.
- `cargo fmt --all -- --check`: pass.
- `cargo clippy -p cashmemo-api --all-targets --all-features -- -D warnings`: pass.
- `pnpm v1:api:generate`: pass.
- `pnpm v1:api:check`: pass with no drift.
- Strict generated-client `tsc --noEmit`: pass.
