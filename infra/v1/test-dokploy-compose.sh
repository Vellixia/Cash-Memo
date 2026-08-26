#!/bin/sh
set -eu

compose_file=${1:-infra/v1/dokploy-compose.yml}
compose_bin=${COMPOSE_BIN:-docker-compose}
failures=0

fail() {
  printf '%s\n' "FAIL: $*" >&2
  failures=$((failures + 1))
}

base_env() {
  env -i \
    PATH="$PATH" \
    HOME="${HOME:-/tmp}" \
    DOCKER_CONFIG="${DOCKER_CONFIG:-${HOME:-/tmp}/.docker}" \
    "$@"
}

expect_render_failure() {
  expected=$1
  shift
  stderr_file=$(mktemp)
  if base_env "$@" "$compose_bin" -f "$compose_file" config >/dev/null 2>"$stderr_file"; then
    fail "Compose rendered without required $expected"
  elif ! grep -F "$expected" "$stderr_file" >/dev/null; then
    fail "missing-config error did not name $expected"
  fi
  rm -f "$stderr_file"
}

expect_render_failure CASHMEMO_V1_DATABASE_URL \
  CASHMEMO_V1_POSTGRES_PASSWORD=test-postgres-password \
  CASHMEMO_V1_TRUSTED_PROXY_CIDRS=172.31.0.0/16
expect_render_failure CASHMEMO_V1_POSTGRES_PASSWORD \
  CASHMEMO_V1_DATABASE_URL=postgres://cashmemo:test@cashmemo-v1-postgres:5432/cashmemo_v1 \
  CASHMEMO_V1_TRUSTED_PROXY_CIDRS=172.31.0.0/16
expect_render_failure CASHMEMO_V1_TRUSTED_PROXY_CIDRS \
  CASHMEMO_V1_DATABASE_URL=postgres://cashmemo:test@cashmemo-v1-postgres:5432/cashmemo_v1 \
  CASHMEMO_V1_POSTGRES_PASSWORD=test-postgres-password

rendered=$(mktemp)
trap 'rm -f "$rendered"' EXIT HUP INT TERM
base_env \
  CASHMEMO_V1_DATABASE_URL=postgres://cashmemo:test@cashmemo-v1-postgres:5432/cashmemo_v1 \
  CASHMEMO_V1_POSTGRES_PASSWORD=test-postgres-password \
  CASHMEMO_V1_TRUSTED_PROXY_CIDRS=172.31.0.0/16 \
  CASHMEMO_V1_DOKPLOY_NETWORK=task20-edge \
  CASHMEMO_V1_PRIVATE_NETWORK=task20-private \
  "$compose_bin" -f "$compose_file" config --format json >"$rendered"

jq -e '.networks["cashmemo-v1-private"].name == "task20-private"' "$rendered" >/dev/null ||
  fail "private network name is not stable/configurable"
jq -e '.services["cashmemo-v1-api"].labels["traefik.docker.network"] == "task20-edge"' "$rendered" >/dev/null ||
  fail "API does not select Traefik edge network"
jq -e '.services["cashmemo-v1-api"].healthcheck.test[-1] == "http://127.0.0.1:3000/api/v1/health/ready"' "$rendered" >/dev/null ||
  fail "API orchestrator healthcheck does not use readiness"
jq -e '.services["cashmemo-v1-api"].labels["traefik.http.routers.cashmemo-v1-api.rule"] == "Host(`cashmemo.example`) && (Path(`/api/v1`) || PathPrefix(`/api/v1/`))"' "$rendered" >/dev/null ||
  fail "API Traefik rule does not constrain exact V1 namespace"
jq -e '.services["cashmemo-v1-postgres"].environment.POSTGRES_PASSWORD == "test-postgres-password"' "$rendered" >/dev/null ||
  fail "PostgreSQL password fixture did not render"
jq -e '.services["cashmemo-v1-api"].environment.CASHMEMO_V1_DATABASE_URL == "postgres://cashmemo:test@cashmemo-v1-postgres:5432/cashmemo_v1"' "$rendered" >/dev/null ||
  fail "database URL fixture did not render"
jq -e '.services["cashmemo-v1-api"].environment.CASHMEMO_V1_BIND_ADDR == "0.0.0.0:3000"' "$rendered" >/dev/null ||
  fail "approved container bind control missing"
jq -e '(.services["cashmemo-v1-api"].environment | has("CASHMEMO_V1_ARGON2_MEMORY_KIB") and has("CASHMEMO_V1_ARGON2_TIME_COST") and has("CASHMEMO_V1_ARGON2_PARALLELISM"))' "$rendered" >/dev/null ||
  fail "approved Argon2 tuning controls missing"
jq -e '.services["cashmemo-v1-api"].environment.CASHMEMO_V1_TRUSTED_PROXY_CIDRS == "172.31.0.0/16"' "$rendered" >/dev/null ||
  fail "API trusted-proxy CIDRs are not explicit"
jq -e '.["x-traefik-static-arguments"] == ["--entryPoints.websecure.forwardedHeaders.insecure=false", "--entryPoints.websecure.forwardedHeaders.notAppendXForwardedFor=false", "--entryPoints.websecure.forwardedHeaders.trustedIPs=", "--entryPoints.websecure.http.maxHeaderBytes=8192"]' "$rendered" >/dev/null ||
  fail "Traefik safe-append and header-limit policy are not explicit"

if [ "$failures" -ne 0 ]; then
  printf '%s\n' "Compose contract failures: $failures" >&2
  exit 1
fi

printf '%s\n' "Compose contract PASS"
