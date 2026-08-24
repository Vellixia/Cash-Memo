#!/usr/bin/env bash
set -euo pipefail

usage() { printf '%s\n' 'usage: verify-restore.sh --evidence FILE' >&2; exit 2; }
[[ $# -eq 2 && $1 == --evidence ]] || usage
evidence=$2
[[ -f $evidence && ! -L $evidence ]] || { printf '%s\n' 'RESTORE_EVIDENCE_INVALID' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf '%s\n' 'RESTORE_VERIFICATION_JQ_REQUIRED' >&2; exit 1; }

jq -e '
  type == "object"
  and .target_class == "isolated_restored_v1"
  and .network_exposed == false
  and .application_traffic_enabled == false
  and (.backup_id | type == "string" and length > 0)
  and (.backup_freshness_evidence | type == "string" and length > 0)
  and .pitr_verified == true
  and (.replay_summary | type == "object"
       and (.unreadable_receipts | type == "number" and . == 0)
       and (.unprocessed_matches | type == "number" and . == 0))
' -- "$evidence" >/dev/null 2>&1 || { printf '%s\n' 'RESTORE_EVIDENCE_INVALID' >&2; exit 1; }
printf '%s\n' 'RESTORE_VERIFICATION_PASS'
