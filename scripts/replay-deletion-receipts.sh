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
for name in CASHMEMO_V1_RESTORE_EVIDENCE_FILE CASHMEMO_V1_RESTORED_TARGET_ID \
  CASHMEMO_V1_RESTORED_DATABASE_NAME CASHMEMO_V1_RESTORED_DATABASE_FINGERPRINT \
  CASHMEMO_V1_RESTORE_BACKUP_ID CASHMEMO_V1_RESTORE_BACKUP_FRESH_AT \
  CASHMEMO_V1_RESTORE_PITR_PROOF_ID CASHMEMO_V1_RESTORE_OPERATOR_ID \
  CASHMEMO_V1_RESTORE_APPROVAL_ID CASHMEMO_V1_RESTORE_APPROVAL_IDENTITY; do
  require "$name"
done
source "$(dirname "${BASH_SOURCE[0]}")/evidence-contract.sh"
evidence_key=$(evidence_require_hex_key CASHMEMO_V1_RESTORE_EVIDENCE_HMAC_KEY) || {
  printf '%s\n' 'RESTORE_EVIDENCE_AUTH_REQUIRED' >&2; exit 2;
}
[[ ${CASHMEMO_V1_RESTORED_DATABASE_FINGERPRINT:-} =~ ^sha256:[a-f0-9]{64}$ ]] || {
  printf '%s\n' 'RESTORE_DATABASE_FINGERPRINT_INVALID' >&2; exit 2;
}
evidence_file=$CASHMEMO_V1_RESTORE_EVIDENCE_FILE
evidence_dir=$(dirname "$evidence_file")
[[ -d $evidence_dir && ! -L $evidence_dir && ! -L $evidence_file ]] || {
  printf '%s\n' 'RESTORE_EVIDENCE_PATH_INVALID' >&2; exit 2;
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
set +e
summary=$(cargo run -p cashmemo-api --bin cashmemo-api --features s3-receipts -- replay-deletion-receipts \
  --acknowledge-isolated-restored-database 2>/dev/null)
command_status=$?
set -e
printf '%s' "$summary" | jq -e '
  type == "object" and keys == ["receipts_scanned","unprocessed_matches","unreadable_receipts","users_purged"]
  and all(.[]; type == "number" and floor == . and . >= 0 and . <= 9007199254740991)
' >/dev/null 2>&1 || { printf '%s\n' 'REPLAY_SUMMARY_INVALID' >&2; exit 1; }
issued_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
expires_at=$(date -u -v+10M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)
temporary=$(mktemp "$evidence_dir/.restore-replay.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
umask 077
jq -n --arg issued "$issued_at" --arg expires "$expires_at" --arg target "$CASHMEMO_V1_RESTORED_TARGET_ID" \
  --arg database "$CASHMEMO_V1_RESTORED_DATABASE_NAME" --arg fingerprint "$CASHMEMO_V1_RESTORED_DATABASE_FINGERPRINT" \
  --arg backup "$CASHMEMO_V1_RESTORE_BACKUP_ID" --arg fresh "$CASHMEMO_V1_RESTORE_BACKUP_FRESH_AT" \
  --arg proof "$CASHMEMO_V1_RESTORE_PITR_PROOF_ID" --arg operator "$CASHMEMO_V1_RESTORE_OPERATOR_ID" \
  --arg approval "$CASHMEMO_V1_RESTORE_APPROVAL_ID" --arg identity "$CASHMEMO_V1_RESTORE_APPROVAL_IDENTITY" \
  --argjson replay_summary "$summary" '
  {schema_version:1,evidence_id:("restore-replay-" + $target + "-" + $issued),issued_at:$issued,expires_at:$expires,
   target:{class:"isolated_restored_v1",id:$target},database:{name:$database,fingerprint:$fingerprint},
   isolation:{network_exposed:false,application_traffic_enabled:false},backup:{id:$backup,fresh_at:$fresh},pitr:{verified:true,proof_id:$proof},
   replay_summary:$replay_summary,operator:{id:$operator,approved_at:$issued},approval:{id:$approval,identity:$identity,signed_at:$issued},signature:""}
' >"$temporary"
signature=$(evidence_signature "$temporary" "$evidence_key")
jq --arg signature "$signature" '.signature = $signature' "$temporary" >"$temporary.signed"
mv -f "$temporary.signed" "$temporary"
mv -f "$temporary" "$evidence_file"
trap - EXIT HUP INT TERM
if [[ $command_status -ne 0 ]]; then
  printf '%s\n' 'REPLAY_NOT_READY' >&2
  exit 1
fi
printf '%s\n' 'RESTORE_REPLAY_EVIDENCE_WRITTEN'
