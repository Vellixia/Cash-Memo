#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'usage: production-replacement-gate.sh --target-class CLASS --target-id ID [--evidence FILE]' >&2
  exit 2
}

target_class= target_id= evidence=
while (($#)); do
  case $1 in
    --target-class) (($# >= 2)) || usage; target_class=$2; shift 2 ;;
    --target-id) (($# >= 2)) || usage; target_id=$2; shift 2 ;;
    --evidence) (($# >= 2)) || usage; evidence=$2; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n $target_class && -n $target_id ]] || usage

if [[ $target_class == disposable-isolated-v1 ]]; then
  [[ $target_id =~ ^v1-(development|staging)-[a-z0-9-]+$ ]] || {
    printf '%s\n' 'TARGET_CLASSIFICATION_INVALID' >&2; exit 1;
  }
  printf '%s\n' 'DISPOSABLE_ISOLATED_V1_GATE_PASS'
  exit 0
fi

[[ $target_class == production && -n $evidence ]] || {
  printf '%s\n' 'PRESERVATION_EVIDENCE_REQUIRED' >&2; exit 1;
}
audit_output=''
if ! audit_output="$("$(dirname "$0")/preservation-audit.sh" --evidence "$evidence")"; then
  printf '%s\n' "$audit_output"
  exit 1
fi
[[ $audit_output == PRESERVATION_AUDIT_PASS ]] || {
  printf '%s\n' 'PRESERVATION_EVIDENCE_INVALID' >&2; exit 1;
}
printf '%s\n' 'PRODUCTION_REPLACEMENT_GATE_PASS'
