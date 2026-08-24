#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$script_dir" rev-parse --show-toplevel)
manifest="$repo/docs/verification/legacy-removal-manifest.md"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  printf '%s\n' 'usage: apply-approved-legacy-removal.sh [--check MANIFEST_SHA256 | --apply MANIFEST_SHA256]' >&2
  exit 2
}

manifest_hash() {
  shasum -a 256 "$manifest" | cut -d' ' -f1
}

scoped_paths() {
  git -C "$repo" ls-files -- \
    apps/server apps/web \
    packages/contracts packages/currency-registry packages/domain packages/privacy-rules packages/test-support \
    specs/001-cashmemo-mvp config .github infra ops \
    docs/architecture/self-hosted-reconciliation.md docs/privacy docs/providers \
    tests/acceptance tests/architecture tests/failure tests/operations tests/privacy tests/providers tests/security \
    scripts \
    .dockerignore .env.example .gitignore .gitleaks.toml .prettierignore .terraformignore .tool-versions .trivyignore \
    Cargo.lock Cargo.toml README.md dependency-cruiser.config.d.mts dependency-cruiser.config.mjs \
    eslint.config.mjs package.json packages/tsconfig.json playwright.config.ts pnpm-lock.yaml pnpm-workspace.yaml \
    prettier.config.mjs rust-toolchain.toml task-13-report.md tsconfig.base.json \
    | grep -v '^scripts/apply-approved-legacy-removal\.sh$' \
    | LC_ALL=C sort
}

inventory_records() {
  awk '
    $0 == "<!-- INVENTORY-BEGIN -->" { inside=1; next }
    $0 == "<!-- INVENTORY-END -->" { inside=0; next }
    inside && NF { print }
  ' "$manifest"
}

validate_manifest() {
  local work expected records duplicate missing extra invalid preserve_error
  work=$(mktemp -d)
  trap 'rm -rf -- "$work"' RETURN
  expected="$work/expected"
  records="$work/records"

  [[ $(grep -c '^<!-- INVENTORY-BEGIN -->$' "$manifest") -eq 1 ]] || fail LEGACY_REMOVAL_MANIFEST_INVALID
  [[ $(grep -c '^<!-- INVENTORY-END -->$' "$manifest") -eq 1 ]] || fail LEGACY_REMOVAL_MANIFEST_INVALID
  scoped_paths >"$expected"
  inventory_records >"$records"
  [[ -s $records ]] || fail LEGACY_REMOVAL_MANIFEST_INVALID

  invalid=$(awk -F '\t' '
    NF != 4 || ($1 != "REMOVE" && $1 != "PRESERVE" && $1 != "ALREADY_REUSED") || $2 == "" || $3 == "" || $4 == "" { print; exit }
  ' "$records")
  [[ -z $invalid ]] || fail LEGACY_REMOVAL_MANIFEST_INVALID

  duplicate=$(cut -f2 "$records" | LC_ALL=C sort | uniq -d | head -n 1)
  [[ -z $duplicate ]] || fail LEGACY_REMOVAL_MANIFEST_DUPLICATE
  cut -f2 "$records" | LC_ALL=C sort >"$work/actual"
  missing=$(comm -23 "$expected" "$work/actual" | head -n 1)
  extra=$(comm -13 "$expected" "$work/actual" | head -n 1)
  [[ -z $missing && -z $extra ]] || fail LEGACY_REMOVAL_MANIFEST_INCOMPLETE

  preserve_error=$(awk -F '\t' '
    $2 ~ /^apps\/server\/src\/adapters\/postgres\/migrations\// && $1 != "PRESERVE" { print; exit }
    $1 == "PRESERVE" && ($3 != "LEGACY_HISTORY_EXTERNAL_AUDIT_UNRESOLVED" || $4 != "docs/operations/preservation-gate.md;ops/evidence/external/dokploy-environment.json@sha256:c5ed4785a07d4f97352bda713dcccd5405acb2759bf5dc606ffe9d721c3afe2b") { print; exit }
    $1 != "PRESERVE" && $4 != "-" { print; exit }
  ' "$records")
  [[ -z $preserve_error ]] || fail LEGACY_REMOVAL_PRESERVATION_INVALID

  awk -F '\t' '
    $3 != "LEGACY_RUNTIME_REPLACED" &&
    $3 != "LEGACY_NON_GOAL_REMOVED" &&
    $3 != "LEGACY_HISTORY_EXTERNAL_AUDIT_UNRESOLVED" &&
    $3 != "V1_SHARED_FOUNDATION" { exit 1 }
  ' "$records" || fail LEGACY_REMOVAL_REASON_INVALID
}

check_task_23_evidence() {
  local readiness="$repo/docs/verification/v1-merge-readiness.md"
  [[ -f $readiness ]] || fail TASK_23_READINESS_EVIDENCE_MISSING
  grep -F 'Three fresh default six-flow/four-worker runs' "$readiness" >/dev/null || fail TASK_23_READINESS_EVIDENCE_MISSING
  grep -F 'Ownership, session, money, recurrence, purge-race, migration-target tests' "$readiness" >/dev/null || fail TASK_23_READINESS_EVIDENCE_MISSING
}

check_preservation_state() {
  local output
  if ! output=$("$repo/scripts/preservation-audit.sh" --check-recorded-decision); then
    printf '%s\n' "$output"
    exit 1
  fi
  [[ $output == PRESERVATION_DECISION_UNRESOLVED_PRESERVE_LEGACY_HISTORY ]] || fail PRESERVATION_DECISION_INVALID
}

mode=check
expected_hash=
[[ -f $manifest && ! -L $manifest ]] || fail LEGACY_REMOVAL_MANIFEST_INVALID
case $# in
  0) expected_hash=$(manifest_hash) ;;
  2)
    case $1 in
      --check) mode=check ;;
      --apply) mode=apply ;;
      *) usage ;;
    esac
    expected_hash=$2
    ;;
  *) usage ;;
esac

[[ $expected_hash =~ ^[a-f0-9]{64}$ ]] || fail LEGACY_REMOVAL_MANIFEST_HASH_INVALID
[[ $(manifest_hash) == "$expected_hash" ]] || fail LEGACY_REMOVAL_MANIFEST_HASH_MISMATCH
validate_manifest
check_preservation_state

if [[ $mode == check ]]; then
  printf '%s\n' 'LEGACY_REMOVAL_CHECK_PASS'
  exit 0
fi

[[ $(git -C "$repo" branch --show-current) == rewrite/cashmemo-v1 ]] || fail LEGACY_REMOVAL_BRANCH_INVALID
[[ -z $(git -C "$repo" status --porcelain=v1 --untracked-files=no) ]] || fail LEGACY_REMOVAL_TRACKED_WORKTREE_DIRTY
check_task_23_evidence

remove_paths=()
while IFS=$'\t' read -r status path _rest; do
  if [[ $status == REMOVE ]]; then
    remove_paths+=("$path")
  fi
done < <(inventory_records)
[[ ${#remove_paths[@]} -gt 0 ]] || fail LEGACY_REMOVAL_SET_EMPTY

git -C "$repo" rm -- "${remove_paths[@]}"
printf '%s\n' 'LEGACY_REMOVAL_APPLY_PASS'
