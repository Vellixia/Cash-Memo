#!/usr/bin/env bash
set -euo pipefail

usage() { printf '%s\n' 'usage: preservation-audit.sh --evidence FILE' >&2; exit 2; }
[[ $# -eq 2 && $1 == --evidence ]] || usage
evidence=$2
[[ -f $evidence && ! -L $evidence ]] || { printf '%s\n' 'PRESERVATION_EVIDENCE_INVALID' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf '%s\n' 'PRESERVATION_AUDIT_JQ_REQUIRED' >&2; exit 1; }

valid=$(
  jq -e '
    type == "object"
    and (.operator_id | type == "string" and test("^[A-Za-z0-9._@-]{3,128}$"))
    and (.dokploy_inventory | type == "object"
         and (.service | type == "string" and length > 0)
         and (.config_digest | type == "string" and test("^sha256:[a-f0-9]{64}$")))
    and (.actual_database | type == "object"
         and (.name | type == "string" and length > 0)
         and (.fingerprint | type == "string" and test("^sha256:[a-f0-9]{64}$")))
    and (.table_row_evidence | type == "object"
         and (.users | type == "number" and . >= 0))
    and (.backup_inventory | type == "object"
         and (.latest_backup | type == "string" and length > 0)
         and (.fresh_at | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T")))
    and (.evidence_expires_at | type == "string"
         and (try fromdateiso8601 catch 0) > now)
    and (.real_user_data | type == "boolean")
    and (.approval_record | type == "object"
         and (.id | type == "string" and length > 0)
         and (.signed_by | type == "string" and length > 0)
         and (.signed_at | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T")))
  ' -- "$evidence" 2>/dev/null
) || { printf '%s\n' 'PRESERVATION_EVIDENCE_INVALID' >&2; exit 1; }
[[ $valid == true ]] || { printf '%s\n' 'PRESERVATION_EVIDENCE_INVALID' >&2; exit 1; }

if [[ $(jq -r '.real_user_data' -- "$evidence") == true ]]; then
  printf '%s\n' 'STOP_REQUIRES_DEDICATED_MIGRATION_PLAN'
  exit 1
fi
printf '%s\n' 'PRESERVATION_AUDIT_PASS'
