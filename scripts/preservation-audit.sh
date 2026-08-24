#!/usr/bin/env bash
set -euo pipefail

usage() { printf '%s\n' 'usage: preservation-audit.sh --evidence FILE --target-class CLASS --target-id ID --dokploy-service SERVICE --dokploy-config-digest DIGEST --database-name NAME --database-fingerprint FINGERPRINT' >&2; exit 2; }
evidence= target_class= target_id= service= config_digest= database_name= database_fingerprint=
while (($#)); do
  case $1 in
    --evidence) (($# >= 2)) || usage; evidence=$2; shift 2 ;;
    --target-class) (($# >= 2)) || usage; target_class=$2; shift 2 ;;
    --target-id) (($# >= 2)) || usage; target_id=$2; shift 2 ;;
    --dokploy-service) (($# >= 2)) || usage; service=$2; shift 2 ;;
    --dokploy-config-digest) (($# >= 2)) || usage; config_digest=$2; shift 2 ;;
    --database-name) (($# >= 2)) || usage; database_name=$2; shift 2 ;;
    --database-fingerprint) (($# >= 2)) || usage; database_fingerprint=$2; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n $evidence && -n $target_class && -n $target_id && -n $service && -n $config_digest && -n $database_name && -n $database_fingerprint ]] || usage
source "$(dirname "${BASH_SOURCE[0]}")/evidence-contract.sh"
evidence_regular_file "$evidence" || { printf '%s\n' 'PRESERVATION_EVIDENCE_INVALID' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf '%s\n' 'PRESERVATION_AUDIT_JQ_REQUIRED' >&2; exit 1; }
key=$(evidence_require_hex_key CASHMEMO_V1_PRESERVATION_EVIDENCE_HMAC_KEY) || { printf '%s\n' 'PRESERVATION_EVIDENCE_AUTH_REQUIRED' >&2; exit 1; }

valid=$(
  jq -e '
    def id: type == "string" and test("^[A-Za-z0-9._:-]{3,128}$");
    def digest: type == "string" and test("^sha256:[a-f0-9]{64}$");
    def stamp: type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$") and (try fromdateiso8601 catch null);
    def rows: type == "number" and floor == . and . >= 0 and . <= 9007199254740991;
    type == "object"
    and (keys == ["approval","backup","database","disposition","dokploy","evidence_id","expires_at","issued_at","operator","real_user_data","schema_version","signature","table_row_inventory","target"])
    and .schema_version == 1 and (.evidence_id | id)
    and (.target | type == "object" and keys == ["class","id"] and .class == $class and .id == $target)
    and (.dokploy | type == "object" and keys == ["config_digest","service"] and .service == $service and .config_digest == $config)
    and (.database | type == "object" and keys == ["fingerprint","name"] and .name == $database and .fingerprint == $fingerprint and (.fingerprint | digest))
    and (.table_row_inventory | type == "object" and keys == ["complete","tables"] and .complete == true and (.tables | type == "array" and length > 0 and ([.[] | .table] | unique | length == length) and all(.[]; type == "object" and keys == ["rows","table"] and (.table | id) and (.rows | rows)) and any(.[]; .table == "users")))
    and (.backup | type == "object" and keys == ["fresh_at","id"] and (.id | id) and (.fresh_at | stamp))
    and (.operator | type == "object" and keys == ["approved_at","id"] and (.id | id) and (.approved_at | stamp))
    and (.approval | type == "object" and keys == ["id","identity","signed_at"] and (.id | id) and (.identity | id) and (.signed_at | stamp))
    and (.issued_at | stamp) and (.expires_at | stamp)
    and (.real_user_data | type == "boolean") and (.disposition | type == "string" and . as $d | ["empty_database","development_data_disposable","real_user_data_requires_migration"] | index($d) != null)
    and ((.issued_at | fromdateiso8601) <= now + 300 and (.issued_at | fromdateiso8601) >= now - 900 and (.expires_at | fromdateiso8601) > (.issued_at | fromdateiso8601) and (.expires_at | fromdateiso8601) <= (.issued_at | fromdateiso8601) + 900 and (.backup.fresh_at | fromdateiso8601) <= (.issued_at | fromdateiso8601) and (.backup.fresh_at | fromdateiso8601) >= (.issued_at | fromdateiso8601) - 172800 and (.operator.approved_at | fromdateiso8601) <= (.issued_at | fromdateiso8601) and (.approval.signed_at | fromdateiso8601) <= (.issued_at | fromdateiso8601))
    and ((.table_row_inventory.tables | map(.rows) | add) == 0 and .real_user_data == false and .disposition == "empty_database" or ((.table_row_inventory.tables | map(.rows) | add) > 0 and .real_user_data == false and .disposition == "development_data_disposable") or (.real_user_data == true and .disposition == "real_user_data_requires_migration"))
  ' --arg class "$target_class" --arg target "$target_id" --arg service "$service" --arg config "$config_digest" --arg database "$database_name" --arg fingerprint "$database_fingerprint" -- "$evidence" 2>/dev/null
) || { printf '%s\n' 'PRESERVATION_EVIDENCE_INVALID' >&2; exit 1; }
[[ $valid == true ]] || { printf '%s\n' 'PRESERVATION_EVIDENCE_INVALID' >&2; exit 1; }
evidence_signature_valid "$evidence" "$key" || { printf '%s\n' 'PRESERVATION_EVIDENCE_INVALID' >&2; exit 1; }

if [[ $(jq -r '.real_user_data' -- "$evidence") == true ]]; then
  printf '%s\n' 'STOP_REQUIRES_DEDICATED_MIGRATION_PLAN'
  exit 1
fi
printf '%s\n' 'PRESERVATION_AUDIT_PASS'
