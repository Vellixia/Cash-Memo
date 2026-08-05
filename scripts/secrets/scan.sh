#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

fail=0
finding_file="$(mktemp)"
trap 'rm -f "${finding_file}"' EXIT
for expression in \
  '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|^[[:space:]]*(aws_secret_access_key|APPWRITE_SERVER_API_KEY|FINGERPRINT_KEK_CURRENT)[[:space:]]*=[[:space:]]*[^$[:space:]])' \
  '(changeme|example-secret|password123|sk-[A-Za-z0-9]{20,})'
do
  if git ls-files -z --cached --others --exclude-standard |
    rg -z -v '^(scripts/secrets/scan\.sh|tests/privacy/fixtures/canaries\.json)$' |
    xargs -0 rg -l --no-messages --color never "${expression}" > "${finding_file}"
  then
    printf '%s\n' 'secret scan found a forbidden credential pattern in:' >&2
    sed 's/^/  /' "${finding_file}" >&2
    fail=1
  fi
done

if ! node scripts/secrets/entropy-scan.mjs; then
  fail=1
fi

for name in FINGERPRINT_KEK_CURRENT CURSOR_AEAD_KEY PURGE_TOKEN_KEY USER_PARTITION_KEY COOKIE_SECRET; do
  rg -q "\"${name}\"" config/env.schema.json || fail=1
done

if [[ "${fail}" -ne 0 ]]; then
  printf '%s\n' 'secret scan failed; candidate values were not printed' >&2
  exit 1
fi
printf '%s\n' 'secret and entropy scans passed; no candidate values emitted'
