#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

secret_dir="config/local-secrets"
secret_file="${secret_dir}/cashmemo.env"
mkdir -p "${secret_dir}"
tmp_file="$(mktemp "${secret_dir}/cashmemo.env.XXXXXX")"
trap 'rm -f "${tmp_file}"' EXIT
if [[ -f "${secret_file}" ]]; then
  cp "${secret_file}" "${tmp_file}"
fi

random_b64() { openssl rand -base64 32 | tr -d '\n'; }
random_hex() { openssl rand -hex 32; }
has_name() { rg -q "^${1}=" "${tmp_file}"; }
ensure_literal() { has_name "${1}" || printf '%s=%s\n' "${1}" "${2}" >> "${tmp_file}"; }
ensure_random_b64() { has_name "${1}" || printf '%s=%s\n' "${1}" "$(random_b64)" >> "${tmp_file}"; }
ensure_random_hex() { has_name "${1}" || printf '%s=%s\n' "${1}" "$(random_hex)" >> "${tmp_file}"; }

ensure_literal FINGERPRINT_KEK_CURRENT_ID "kek-$(date -u +%Y%m%d)"
ensure_random_b64 FINGERPRINT_KEK_CURRENT
ensure_random_b64 CURSOR_AEAD_KEY
ensure_random_b64 PURGE_TOKEN_KEY
ensure_random_b64 USER_PARTITION_KEY
ensure_random_b64 COOKIE_SECRET
ensure_random_b64 APPWRITE_OPENSSL_KEY
ensure_random_hex APPWRITE_DB_ROOT_PASSWORD
ensure_random_hex APPWRITE_DB_PASSWORD
ensure_literal APPWRITE_ENDPOINT http://localhost:8180/v1
ensure_literal APPWRITE_PROJECT_ID cashmemo-test
ensure_literal APPWRITE_DATABASE_ID cashmemo
ensure_literal APPWRITE_CONSOLE_EMAIL cashmemo-console@localhost.test
ensure_random_b64 APPWRITE_CONSOLE_PASSWORD
ensure_literal OPENOBSERVE_ROOT_EMAIL cashmemo-observe@localhost.test
ensure_random_b64 OPENOBSERVE_ROOT_PASSWORD
ensure_literal SUPPRESSION_S3_ACCESS_KEY "$(openssl rand -hex 16)"
ensure_random_b64 SUPPRESSION_S3_SECRET_KEY
ensure_literal OTEL_EXPORTER_OTLP_ENDPOINT http://localhost:4317

observe_email="$(sed -n 's/^OPENOBSERVE_ROOT_EMAIL=//p' "${tmp_file}")"
observe_password="$(sed -n 's/^OPENOBSERVE_ROOT_PASSWORD=//p' "${tmp_file}")"
observe_credential="$(printf '%s:%s' "${observe_email}" "${observe_password}" | openssl base64 -A)"
filtered_file="$(mktemp "${secret_dir}/cashmemo.filtered.XXXXXX")"
trap 'rm -f "${tmp_file}" "${filtered_file}"' EXIT
rg -v '^(OPENOBSERVE_AUTH_HEADER|OPENOBSERVE_AUTH_CREDENTIAL|APPWRITE_SERVER_API_KEY)=' "${tmp_file}" > "${filtered_file}" || true
printf 'OPENOBSERVE_AUTH_CREDENTIAL=%s\n' "${observe_credential}" >> "${filtered_file}"
mv "${filtered_file}" "${secret_file}"
chmod 600 "${secret_file}"
touch "${secret_dir}/appwrite-runtime.env"
chmod 600 "${secret_dir}/appwrite-runtime.env"
trap - EXIT
