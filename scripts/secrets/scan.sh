#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

fail=0
scan_files="$(git ls-files --cached --others --exclude-standard | rg -v '^(specs/|docs/|shared/currencies/|tests/privacy/fixtures/|scripts/secrets/scan\.sh)' || true)"

if [[ -n "${scan_files}" ]]; then
  if rg -n --no-heading --color never '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|^[[:space:]]*(aws_secret_access_key|APPWRITE_SERVER_API_KEY|FINGERPRINT_KEK_CURRENT)[[:space:]]*=[[:space:]]*[^$[:space:]])' ${scan_files}; then
    fail=1
  fi
  if rg -n --no-heading --color never '(changeme|example-secret|password123|sk-[A-Za-z0-9]{20,})' ${scan_files}; then
    fail=1
  fi
fi

for name in FINGERPRINT_KEK_CURRENT CURSOR_AEAD_KEY PURGE_TOKEN_KEY USER_PARTITION_KEY COOKIE_SECRET; do
  rg -q "\"${name}\"" config/env.schema.json || fail=1
done

if [[ "${fail}" -ne 0 ]]; then
  printf '%s\n' 'secret scan failed' >&2
  exit 1
fi
printf '%s\n' 'secret scan passed; no secret values emitted'
