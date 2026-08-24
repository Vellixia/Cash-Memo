#!/usr/bin/env bash
set -euo pipefail

require() { [[ -n ${!1:-} ]] || { printf '%s\n' "${1}_REQUIRED" >&2; exit 2; }; }
[[ ${CASHMEMO_V1_RESTORED_DATABASE_ISOLATED:-} == acknowledged ]] || {
  printf '%s\n' 'ISOLATED_RESTORED_DATABASE_ACKNOWLEDGEMENT_REQUIRED' >&2; exit 2;
}
[[ ${CASHMEMO_V1_RECEIPT_CREDENTIAL_SCOPE:-} == read-only ]] || {
  printf '%s\n' 'READ_ONLY_RECEIPT_CREDENTIALS_REQUIRED' >&2; exit 2;
}
for name in CASHMEMO_V1_DATABASE_URL CASHMEMO_V1_DELETION_RECEIPT_HMAC_KEYS \
  CASHMEMO_V1_DELETION_RECEIPT_S3_ENDPOINT CASHMEMO_V1_DELETION_RECEIPT_S3_REGION \
  CASHMEMO_V1_DELETION_RECEIPT_S3_BUCKET CASHMEMO_V1_DELETION_RECEIPT_S3_PREFIX \
  CASHMEMO_V1_DELETION_RECEIPT_S3_ACCESS_KEY_ID CASHMEMO_V1_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY; do
  require "$name"
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
exec cargo run -p cashmemo-api --features s3-receipts -- replay-deletion-receipts \
  --acknowledge-isolated-restored-database
