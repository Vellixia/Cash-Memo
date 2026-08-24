#!/usr/bin/env bash
set -euo pipefail

usage() { printf '%s\n' 'usage: verify-restore.sh --evidence FILE --target-id ID --database-name NAME --database-fingerprint FINGERPRINT' >&2; exit 2; }
evidence= target_id= database_name= database_fingerprint=
while (($#)); do
  case $1 in
    --evidence) (($# >= 2)) || usage; evidence=$2; shift 2 ;;
    --target-id) (($# >= 2)) || usage; target_id=$2; shift 2 ;;
    --database-name) (($# >= 2)) || usage; database_name=$2; shift 2 ;;
    --database-fingerprint) (($# >= 2)) || usage; database_fingerprint=$2; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n $evidence && -n $target_id && -n $database_name && -n $database_fingerprint ]] || usage
source "$(dirname "${BASH_SOURCE[0]}")/evidence-contract.sh"
evidence_regular_file "$evidence" || { printf '%s\n' 'RESTORE_EVIDENCE_INVALID' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf '%s\n' 'RESTORE_VERIFICATION_JQ_REQUIRED' >&2; exit 1; }
key=$(evidence_require_hex_key CASHMEMO_V1_RESTORE_EVIDENCE_HMAC_KEY) || { printf '%s\n' 'RESTORE_EVIDENCE_AUTH_REQUIRED' >&2; exit 1; }

jq -e '
  def id: type == "string" and test("^[A-Za-z0-9._:-]{3,128}$");
  def digest: type == "string" and test("^sha256:[a-f0-9]{64}$");
  def stamp: type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$") and (try fromdateiso8601 catch null);
  def count: type == "number" and floor == . and . >= 0 and . <= 9007199254740991;
  type == "object"
  and (keys == ["approval","backup","database","evidence_id","expires_at","isolation","issued_at","operator","pitr","replay_summary","schema_version","signature","target"])
  and .schema_version == 1 and (.evidence_id | id)
  and (.target | type == "object" and keys == ["class","id"] and .class == "isolated_restored_v1" and .id == $target)
  and (.database | type == "object" and keys == ["fingerprint","name"] and .name == $database and .fingerprint == $fingerprint and (.fingerprint | digest))
  and (.isolation | type == "object" and keys == ["application_traffic_enabled","network_exposed"] and .network_exposed == false and .application_traffic_enabled == false)
  and (.backup | type == "object" and keys == ["fresh_at","id"] and (.id | id) and (.fresh_at | stamp))
  and (.pitr | type == "object" and keys == ["proof_id","verified"] and .verified == true and (.proof_id | id))
  and (.operator | type == "object" and keys == ["approved_at","id"] and (.id | id) and (.approved_at | stamp))
  and (.approval | type == "object" and keys == ["id","identity","signed_at"] and (.id | id) and (.identity | id) and (.signed_at | stamp))
  and (.issued_at | stamp) and (.expires_at | stamp)
  and (.replay_summary | type == "object" and keys == ["receipts_scanned","unprocessed_matches","unreadable_receipts","users_purged"] and all(.[]; count) and .unreadable_receipts == 0 and .unprocessed_matches == 0)
  and ((.issued_at | fromdateiso8601) <= now and (.issued_at | fromdateiso8601) >= now - 900 and (.expires_at | fromdateiso8601) > now and (.expires_at | fromdateiso8601) > (.issued_at | fromdateiso8601) and (.expires_at | fromdateiso8601) <= (.issued_at | fromdateiso8601) + 900 and (.backup.fresh_at | fromdateiso8601) <= (.issued_at | fromdateiso8601) and (.backup.fresh_at | fromdateiso8601) >= (.issued_at | fromdateiso8601) - 172800 and (.operator.approved_at | fromdateiso8601) <= (.issued_at | fromdateiso8601) and (.approval.signed_at | fromdateiso8601) <= (.issued_at | fromdateiso8601))
' --arg target "$target_id" --arg database "$database_name" --arg fingerprint "$database_fingerprint" -- "$evidence" >/dev/null 2>&1 || { printf '%s\n' 'RESTORE_EVIDENCE_INVALID' >&2; exit 1; }
evidence_signature_valid "$evidence" "$key" || { printf '%s\n' 'RESTORE_EVIDENCE_INVALID' >&2; exit 1; }
printf '%s\n' 'RESTORE_VERIFICATION_PASS'
