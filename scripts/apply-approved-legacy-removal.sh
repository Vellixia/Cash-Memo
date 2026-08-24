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
  printf '%s\n' 'usage: apply-approved-legacy-removal.sh [--check MANIFEST_SHA256 | --plan MANIFEST_SHA256 | --apply MANIFEST_SHA256]' >&2
  exit 2
}

manifest_hash() {
  shasum -a 256 "$manifest" | cut -d' ' -f1
}

scoped_paths() {
  git -C "$repo" ls-files -- \
    apps/server apps/web \
    packages/contracts packages/currency-registry packages/domain packages/privacy-rules packages/test-support \
    specs/001-cashmemo-mvp config .github infra ops .specify \
    docs/architecture/self-hosted-reconciliation.md docs/privacy docs/providers \
    tests/acceptance tests/architecture tests/failure tests/operations tests/privacy tests/providers tests/security tests/tsconfig.json \
    scripts test-results \
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
  local acceptance security readiness acceptance_hash security_hash state
  acceptance="$repo/docs/verification/v1-acceptance.md"
  security="$repo/docs/verification/v1-security-audit.md"
  readiness="$repo/docs/verification/v1-merge-readiness.md"
  [[ -f $acceptance && ! -L $acceptance && -f $security && ! -L $security && -f $readiness && ! -L $readiness ]] || fail TASK_23_READINESS_EVIDENCE_MISSING

  acceptance_hash=$(shasum -a 256 "$acceptance" | cut -d' ' -f1)
  security_hash=$(shasum -a 256 "$security" | cut -d' ' -f1)
  [[ $acceptance_hash == 5edfc61a04b3b0b73d3a83c21c2f4f2fb4665594fe08bc2afee5cd5db585318a ]] || fail TASK_23_READINESS_EVIDENCE_INVALID
  [[ $security_hash == 2ecd21c00037df4f4ebe22c634d420b54b8d42e6878b7410ae3ea4435cbb3bab ]] || fail TASK_23_READINESS_EVIDENCE_INVALID
  [[ $(grep -c '^Status: \*\*NOT READY\*\* as of `[^`]*`\.$' "$readiness") -eq 1 ]] || fail TASK_23_READINESS_EVIDENCE_INVALID

  while IFS=$'\t' read -r criterion expected; do
    state=$(awk -F '|' -v criterion="$criterion" '
      function trim(value) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); return value }
      NF >= 4 && trim($2) == criterion { found++; value=trim($4) }
      END { if (found != 1) exit 1; print value }
    ' "$readiness") || fail TASK_23_READINESS_EVIDENCE_INVALID
    [[ $state == "$expected" ]] || fail TASK_23_READINESS_EVIDENCE_INVALID
  done <<'STATES'
Approved temporary V1 scope, OpenAPI/client drift, lint/type/Vitest/build, Rust checks	PASS
Ownership, session, money, recurrence, purge-race, migration-target tests	PASS
Default real-stack Playwright gate	PASS
Clean-schema and preservation decision	**PENDING**
Canonical structure, one current app/client workflow, no permanent dual stack	**PENDING**
Legacy removal/migration-history decision	**PENDING**
Documentation and final branch review	**PENDING**
STATES
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
      --plan) mode=plan ;;
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
    [[ $path != /* && $path != -* && $path != *'..'* && $path != *'*'* && $path != *'?'* && $path != *'['* ]] || fail LEGACY_REMOVAL_PATH_INVALID
    remove_paths+=("$path")
  fi
done < <(inventory_records)
[[ ${#remove_paths[@]} -gt 0 ]] || fail LEGACY_REMOVAL_SET_EMPTY

git_command=(git -C "$repo" rm -- "${remove_paths[@]}")
if [[ $mode == plan ]]; then
  for index in "${!git_command[@]}"; do
    printf 'ARGV\t%s\t%s\n' "$index" "${git_command[$index]}"
  done
  exit 0
fi

"${git_command[@]}"
printf '%s\n' 'LEGACY_REMOVAL_APPLY_PASS'
