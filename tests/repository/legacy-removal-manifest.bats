#!/usr/bin/env bats

setup() {
  repo="$BATS_TEST_DIRNAME/../.."
  manifest="$repo/docs/verification/legacy-removal-manifest.md"
  script="$repo/scripts/apply-approved-legacy-removal.sh"
}

manifest_hash() {
  shasum -a 256 "$manifest" | cut -d' ' -f1
}

tracked_state() {
  git -C "$repo" status --porcelain=v1 --untracked-files=no
}

@test "manifest check accepts complete exact inventory without changing tracked content" {
  before=$(tracked_state)

  run "$script" --check "$(manifest_hash)"

  [ "$status" -eq 0 ]
  [ "$output" = "LEGACY_REMOVAL_CHECK_PASS" ]
  [ "$(tracked_state)" = "$before" ]
}

@test "default validation is non-mutating" {
  before=$(tracked_state)

  run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "LEGACY_REMOVAL_CHECK_PASS" ]
  [ "$(tracked_state)" = "$before" ]
}

@test "manifest check rejects a wrong digest" {
  run "$script" --check aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_MANIFEST_HASH_MISMATCH" ]
}

@test "manifest records every scoped tracked path exactly once" {
  run "$script" --check "$(manifest_hash)"

  [ "$status" -eq 0 ]
  [ "$output" = "LEGACY_REMOVAL_CHECK_PASS" ]
}

@test "unresolved external audit preserves every legacy migration artifact" {
  while IFS= read -r path; do
    count=$(awk -F '\t' -v path="$path" '$1 == "PRESERVE" && $2 == path { count++ } END { print count + 0 }' "$manifest")
    [ "$count" -eq 1 ]
  done < <(git -C "$repo" ls-files 'apps/server/src/adapters/postgres/migrations/**')

  run "$repo/scripts/preservation-audit.sh" --check-recorded-decision

  [ "$status" -eq 0 ]
  [ "$output" = "PRESERVATION_DECISION_UNRESOLVED_PRESERVE_LEGACY_HISTORY" ]
}

@test "every preserved path names the pinned unresolved-audit source" {
  source='docs/operations/preservation-gate.md;ops/evidence/external/dokploy-environment.json@sha256:c5ed4785a07d4f97352bda713dcccd5405acb2759bf5dc606ffe9d721c3afe2b'

  run awk -F '\t' -v source="$source" '
    $1 == "PRESERVE" && $4 != source { exit 1 }
    ($1 == "REMOVE" || $1 == "ALREADY_REUSED") && $4 != "-" { exit 1 }
  ' "$manifest"

  [ "$status" -eq 0 ]
}

@test "recorded real-user-data discovery stops repository removal preparation" {
  decision="$BATS_TEST_TMPDIR/real-data.json"
  cat >"$decision" <<'JSON'
{
  "schema_version": 1,
  "real_user_data": true,
  "disposition": "real_user_data_requires_migration"
}
JSON

  run env CASHMEMO_V1_RECORDED_PRESERVATION_DECISION_FILE="$decision" \
    "$repo/scripts/preservation-audit.sh" --check-recorded-decision

  [ "$status" -ne 0 ]
  [ "$output" = "STOP_REQUIRES_DEDICATED_MIGRATION_PLAN" ]
}

@test "unlisted scoped tracked path makes check fail" {
  fixture="$BATS_TEST_TMPDIR/repository"
  mkdir -p "$fixture"
  git -C "$repo" ls-files -z | tar --null -T - -cf - | tar -C "$fixture" -xf -
  for path in "$manifest" "$script" "$repo/tests/repository/legacy-removal-manifest.bats"; do
    relative=${path#"$repo/"}
    mkdir -p "$fixture/$(dirname "$relative")"
    cp "$path" "$fixture/$relative"
  done
  cp "$repo/scripts/preservation-audit.sh" "$fixture/scripts/preservation-audit.sh"
  git -C "$fixture" init -q -b rewrite/cashmemo-v1
  git -C "$fixture" add .
  git -C "$fixture" -c user.name=test -c user.email=test@example.invalid commit -qm fixture
  printf '%s\n' 'new legacy file' >"$fixture/apps/server/unlisted.ts"
  git -C "$fixture" add apps/server/unlisted.ts

  fixture_hash=$(shasum -a 256 "$fixture/docs/verification/legacy-removal-manifest.md" | cut -d' ' -f1)
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$fixture_hash"

  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_MANIFEST_INCOMPLETE" ]
}
