#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

secret_dir="config/local-secrets"
secret_file="${secret_dir}/cashmemo.env"
mkdir -p "${secret_dir}"

random_b64() { openssl rand -base64 32 | tr -d '\n'; }

if [[ -e "${secret_file}" ]]; then
  chmod 600 "${secret_file}"
  exit 0
fi

tmp_file="${secret_file}.tmp.$$"
trap 'rm -f "${tmp_file}"' EXIT
{
  printf 'FINGERPRINT_KEK_CURRENT_ID=kek-%s\n' "$(date -u +%Y%m%d)"
  printf 'FINGERPRINT_KEK_CURRENT=%s\n' "$(random_b64)"
  printf 'CURSOR_AEAD_KEY=%s\n' "$(random_b64)"
  printf 'PURGE_TOKEN_KEY=%s\n' "$(random_b64)"
  printf 'USER_PARTITION_KEY=%s\n' "$(random_b64)"
  printf 'COOKIE_SECRET=%s\n' "$(random_b64)"
  printf 'APPWRITE_SERVER_API_KEY=%s\n' "$(random_b64)"
  printf 'APPWRITE_OPENSSL_KEY=%s\n' "$(random_b64)"
  printf 'SUPPRESSION_S3_ACCESS_KEY=%s\n' "$(openssl rand -hex 16)"
  printf 'SUPPRESSION_S3_SECRET_KEY=%s\n' "$(random_b64)"
  printf 'OPENOBSERVE_AUTH_HEADER=Basic%%20%s\n' "$(random_b64)"
} >"${tmp_file}"
chmod 600 "${tmp_file}"
mv "${tmp_file}" "${secret_file}"
trap - EXIT
