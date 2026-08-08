#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

compose=(docker compose --env-file config/local-secrets/cashmemo.env -f infra/compose/docker-compose.yml)
capture_dir="docs/evidence/001/scratch/live-privacy"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

rm -rf "$capture_dir"
mkdir -p "$capture_dir"
chmod 700 "$capture_dir"

export DOCKER_AUTH_CONFIG='{"auths":{}}'
"${compose[@]}" up -d --build backend web

for url in http://127.0.0.1:3000/money-memos/new http://127.0.0.1:3001/health http://127.0.0.1:5080/healthz; do
  ready=false
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "$url"; then ready=true; break; fi
    sleep 2
  done
  if [[ "$ready" != true ]]; then
    printf 'live privacy dependency unavailable\n' >&2
    exit 1
  fi
done

set -a
source config/local-secrets/cashmemo.env
source config/local-secrets/appwrite-runtime.env
set +a
export CASHMEMO_PRIVACY_CAPTURE_DIR="$capture_dir"

npm exec -- playwright test tests/privacy/live_us1.spec.ts
node tests/privacy/send_and_verify_telemetry.mjs
cargo test --manifest-path backend/Cargo.toml -p cashmemo-domain \
  --test privacy_crash_redaction -- --nocapture >"$capture_dir/crash.log" 2>&1

"${compose[@]}" logs --no-color --since "$started_at" backend >"$capture_dir/backend.log" 2>&1
"${compose[@]}" logs --no-color --since "$started_at" web >"$capture_dir/proxy.log" 2>&1
"${compose[@]}" logs --no-color --since "$started_at" appwrite appwrite-worker-databases \
  >"$capture_dir/appwrite.log" 2>&1
"${compose[@]}" logs --no-color --since "$started_at" otel-collector \
  >"$capture_dir/otlp.log" 2>&1
"${compose[@]}" logs --no-color --since "$started_at" \
  >"$capture_dir/container.log" 2>&1

npm exec -- tsx tests/privacy/scan_captures.ts \
  "browser:$capture_dir/browser.json" \
  "backend:$capture_dir/backend.log" \
  "proxy:$capture_dir/proxy.log" \
  "appwrite:$capture_dir/appwrite.log" \
  "container:$capture_dir/container.log" \
  "http_error:$capture_dir/http-error.json" \
  "otlp:$capture_dir/otlp.log" \
  "openobserve:$capture_dir/openobserve.json" \
  "crash:$capture_dir/crash.log" \
  "evidence:docs/evidence/001/us1"
