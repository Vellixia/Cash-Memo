#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

secret_file="config/local-secrets/cashmemo.env"
if [[ ! -f "${secret_file}" ]]; then
  printf '%s\n' 'local secret file missing' >&2
  exit 1
fi
temporary="$(mktemp "config/local-secrets/cashmemo.rotate.XXXXXX")"
trap 'rm -f "${temporary}"' EXIT
rg -v '^(APPWRITE_DB_ROOT_PASSWORD|APPWRITE_DB_PASSWORD)=' "${secret_file}" > "${temporary}" || true
printf 'APPWRITE_DB_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> "${temporary}"
printf 'APPWRITE_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> "${temporary}"
mv "${temporary}" "${secret_file}"
chmod 600 "${secret_file}"
trap - EXIT
