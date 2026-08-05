set shell := ["bash", "-euo", "pipefail", "-c"]

default:
  @just --list

secrets-dev-init:
  @bash scripts/secrets/dev-init.sh

secrets-scan:
  @bash scripts/secrets/scan.sh

environment-check:
  @node scripts/secrets/validate-runtime-env.mjs

architecture-check:
  @bash tests/architecture/repository_layout_test.sh
  @cargo test --manifest-path tests/architecture/Cargo.toml

dependency-policy:
  @cargo deny --manifest-path backend/Cargo.toml check

format:
  @cargo fmt --manifest-path backend/Cargo.toml --all
  @npm run format

format-check:
  @cargo fmt --manifest-path backend/Cargo.toml --all -- --check
  @npm run format:check

lint:
  @cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets --all-features -- -D warnings
  @npm run lint

typecheck:
  @cargo check --manifest-path backend/Cargo.toml --workspace --all-targets
  @npm run typecheck

contracts:
  @node scripts/contracts/validate-openapi.mjs --against specs/001-money-memo-foundation/contracts/openapi-v1.compatibility.json
  @node scripts/contracts/validate-export-schema.mjs
  @node scripts/contracts/validate-pattern-set.mjs
  @node scripts/contracts/check-generated.mjs
  @npm exec -- redocly lint specs/001-money-memo-foundation/contracts/openapi.yaml

test-unit:
  @cargo test --manifest-path backend/Cargo.toml --workspace --lib --tests
  @npm run test:run

test-integration-real:
  @set -a; source config/local-secrets/cashmemo.env; source config/local-secrets/appwrite-runtime.env; set +a; cargo test --manifest-path tests/integration-appwrite/Cargo.toml

test-privacy-real:
  @npm exec -- tsx tests/privacy/scan_captures.ts --self-test

test-acceptance-real:
  @just appwrite-ready
  @set -a; source config/local-secrets/cashmemo.env; source config/local-secrets/appwrite-runtime.env; set +a; npm exec -- playwright test tests/acceptance/us1_create.spec.ts

stack-health:
  @docker compose --env-file config/local-secrets/cashmemo.env -f infra/compose/docker-compose.yml ps --status running

appwrite-provision:
  @set -a; source config/local-secrets/cashmemo.env; source config/local-secrets/appwrite-runtime.env; set +a; npm exec -- tsx infra/appwrite/provision.ts

appwrite-up:
  @just secrets-dev-init
  @docker compose --env-file config/local-secrets/cashmemo.env -f infra/compose/docker-compose.yml up -d appwrite appwrite-worker-databases

appwrite-bootstrap:
  @npm exec -- tsx infra/appwrite/bootstrap.ts

appwrite-ready:
  @just appwrite-up
  @just appwrite-bootstrap
  @just appwrite-provision
  @just appwrite-contract
  @just environment-check

appwrite-contract:
  @set -a; source config/local-secrets/cashmemo.env; source config/local-secrets/appwrite-runtime.env; set +a; cargo test --manifest-path tests/integration-appwrite/Cargo.toml --test schema_contract

dev:
  @just appwrite-ready
  @docker compose --env-file config/local-secrets/cashmemo.env -f infra/compose/docker-compose.yml up --build

acceptance story:
  @case "{{story}}" in \
    us1-create) just _acceptance-us1-create ;; \
    *) printf 'acceptance story not implemented: %s\n' "{{story}}" >&2; exit 2 ;; \
  esac

_acceptance-us1-create:
  @just appwrite-ready
  @just contracts
  @cargo test --manifest-path backend/Cargo.toml -p cashmemo-domain --test create_validation --test creation_fingerprint --test privacy_pattern_v1
  @cargo test --manifest-path backend/Cargo.toml -p cashmemo-application --test fingerprint_key_lifecycle --test create_idempotency --test starter_label_query
  @cargo test --manifest-path backend/Cargo.toml -p cashmemo-http-adapter --test create_contract --test auth_contract --test error_contract
  @npm run test:run --workspace @cashmemo/web -- --run tests/compose-draft.test.ts tests/privacy-pattern-create.test.tsx
  @set -a; source config/local-secrets/cashmemo.env; source config/local-secrets/appwrite-runtime.env; set +a; cargo test --manifest-path tests/integration-appwrite/Cargo.toml --test create_idempotency --test auth_isolation --test not_found_isolation --test direct_tablesdb_denial
  @npm exec -- tsx tests/privacy/scan_captures.ts --self-test
  @node --test tests/privacy/telemetry_allowlist.test.mjs
  @set -a; source config/local-secrets/cashmemo.env; source config/local-secrets/appwrite-runtime.env; set +a; npm exec -- playwright test tests/acceptance/us1_create.spec.ts

acceptance-all:
  @just acceptance us1-create

export-schema-check:
  @node scripts/contracts/validate-export-schema.mjs

export-concurrency *args:
  @printf '%s\n' 'US7 not implemented in US1 milestone' >&2
  @exit 2
