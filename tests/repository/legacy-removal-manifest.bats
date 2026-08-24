#!/usr/bin/env bats

setup() {
  repo="$BATS_TEST_DIRNAME/../.."
  manifest="$repo/docs/verification/legacy-removal-manifest.md"
  reviewed_base=b2d462eacc0307080aea68ce06dd2abc03058f8c
  reviewed_hash=bfcec955cfa58e323312fa8e7250806f1a2354ae28dcbda90d5d9fccdad85d31
}

inventory_records() {
  awk '
    $0 == "<!-- INVENTORY-BEGIN -->" { inside=1; next }
    $0 == "<!-- INVENTORY-END -->" { inside=0; next }
    inside && NF { print }
  ' "$manifest"
}

@test "reviewed manifest identity and inventory counts remain stable after apply" {
  [ "$(shasum -a 256 "$manifest" | cut -d' ' -f1)" = "$reviewed_hash" ]
  [ "$(inventory_records | awk -F '\t' '$1 == "REMOVE" { count++ } END { print count + 0 }')" -eq 388 ]
  [ "$(inventory_records | awk -F '\t' '$1 == "PRESERVE" { count++ } END { print count + 0 }')" -eq 44 ]
  [ "$(inventory_records | awk -F '\t' '$1 == "ALREADY_REUSED" { count++ } END { print count + 0 }')" -eq 67 ]
}

@test "every preservation entry remains with pinned unresolved-audit attribution" {
  source='docs/operations/preservation-gate.md;ops/evidence/external/dokploy-environment.json@sha256:c5ed4785a07d4f97352bda713dcccd5405acb2759bf5dc606ffe9d721c3afe2b'

  while IFS=$'\t' read -r state path reason attribution; do
    [ "$state" = "PRESERVE" ] || continue
    [ -e "$repo/$path" ] || [ -L "$repo/$path" ]
    [ "$reason" = "LEGACY_HISTORY_EXTERNAL_AUDIT_UNRESOLVED" ]
    [ "$attribution" = "$source" ]
  done < <(inventory_records)
}

@test "applied removal entries cannot retain legacy content" {
  failures="$BATS_TEST_TMPDIR/removal-failures"
  : >"$failures"

  while IFS=$'\t' read -r state path _reason _source; do
    [ "$state" = "REMOVE" ] || continue
    if [ -e "$repo/$path" ] || [ -L "$repo/$path" ]; then
      case "$path" in
        apps/web/package.json)
          legacy_blob=$(git -C "$repo" rev-parse "$reviewed_base:$path")
          current_blob=$(git -C "$repo" hash-object "$repo/$path")
          package_name=$(node -p "require('$repo/$path').name")
          build_script=$(node -p "require('$repo/$path').scripts.build")
          if [ "$current_blob" = "$legacy_blob" ] || \
            [ "$package_name" != "@cashmemo/v1-web" ] || [ "$build_script" != "next build" ]; then
            printf 'legacy/canonical collision invalid: %s\n' "$path" >>"$failures"
          fi
          ;;
        apps/web/tsconfig.json)
          legacy_blob=$(git -C "$repo" rev-parse "$reviewed_base:$path")
          current_blob=$(git -C "$repo" hash-object "$repo/$path")
          if [ "$current_blob" = "$legacy_blob" ] || \
            ! grep -Fq '"name": "next"' "$repo/$path" || grep -Fq 'vite/client' "$repo/$path"; then
            printf 'legacy/canonical collision invalid: %s\n' "$path" >>"$failures"
          fi
          ;;
        *) printf 'reviewed removal still exists: %s\n' "$path" >>"$failures" ;;
      esac
    fi
  done < <(inventory_records)

  run test ! -s "$failures"
  if [ "$status" -ne 0 ]; then
    cat "$failures" >&3
  fi
  [ "$status" -eq 0 ]
}

@test "preserved legacy SQL migration bytes still match recorded checksums" {
  run sh -c 'cd "$1" && shasum -a 256 -c checksums.sha256' _ \
    "$repo/apps/server/src/adapters/postgres/migrations"

  [ "$status" -eq 0 ]
}

@test "external data audit remains unresolved and real-user-data evidence still stops" {
  run "$repo/scripts/preservation-audit.sh" --check-recorded-decision
  [ "$status" -eq 0 ]
  [ "$output" = "PRESERVATION_DECISION_UNRESOLVED_PRESERVE_LEGACY_HISTORY" ]

  decision="$BATS_TEST_TMPDIR/real-data.json"
  printf '%s\n' \
    '{' \
    '  "schema_version": 1,' \
    '  "real_user_data": true,' \
    '  "disposition": "real_user_data_requires_migration"' \
    '}' >"$decision"

  run env CASHMEMO_V1_RECORDED_PRESERVATION_DECISION_FILE="$decision" \
    "$repo/scripts/preservation-audit.sh" --check-recorded-decision
  [ "$status" -ne 0 ]
  [ "$output" = "STOP_REQUIRES_DEDICATED_MIGRATION_PLAN" ]
}
