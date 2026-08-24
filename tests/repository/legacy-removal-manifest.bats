#!/usr/bin/env bats

setup() {
  repo="$BATS_TEST_DIRNAME/../.."
  manifest="$repo/docs/verification/legacy-removal-manifest.md"
  reviewed_base=b2d462eacc0307080aea68ce06dd2abc03058f8c
  reviewed_hash=bfcec955cfa58e323312fa8e7250806f1a2354ae28dcbda90d5d9fccdad85d31
  fixture_index=0
}

inventory_records() {
  awk '
    $0 == "<!-- INVENTORY-BEGIN -->" { inside=1; next }
    $0 == "<!-- INVENTORY-END -->" { inside=0; next }
    inside && NF { print }
  ' "$manifest"
}

make_base_fixture() {
  fixture_index=$((fixture_index + 1))
  fixture="$BATS_TEST_TMPDIR/repository-$fixture_index"
  git clone -q "$repo" "$fixture"
  fixture=$(cd "$fixture" && pwd -P)
  git -C "$fixture" switch -q -C rewrite/cashmemo-v1 "$reviewed_base"
}

fixture_hash() {
  shasum -a 256 "$fixture/docs/verification/legacy-removal-manifest.md" | cut -d' ' -f1
}

commit_fixture_change() {
  git -C "$fixture" add .
  git -C "$fixture" -c user.name=test -c user.email=test@example.invalid commit -qm fixture-tamper
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

@test "all preservation blobs remain byte-identical to reviewed base" {
  count=0
  while IFS=$'\t' read -r state path _reason _source; do
    [ "$state" = "PRESERVE" ] || continue
    base_blob=$(git -C "$repo" rev-parse "$reviewed_base:$path")
    current_blob=$(git -C "$repo" hash-object "$repo/$path")
    [ "$current_blob" = "$base_blob" ]
    count=$((count + 1))
  done < <(inventory_records)
  [ "$count" -eq 44 ]
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

@test "reviewed base fixture accepts exact manifest without mutation" {
  make_base_fixture
  before=$(git -C "$fixture" status --porcelain=v1 --untracked-files=no)

  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$reviewed_hash"

  [ "$status" -eq 0 ]
  [ "$output" = "LEGACY_REMOVAL_CHECK_PASS" ]
  [ "$(fixture_hash)" = "$reviewed_hash" ]
  [ "$(git -C "$fixture" status --porcelain=v1 --untracked-files=no)" = "$before" ]
}

@test "reviewed base fixture rejects incomplete malformed duplicate and preservation-tampered inventories" {
  make_base_fixture
  printf '%s\n' 'new legacy file' >"$fixture/apps/server/unlisted.ts"
  git -C "$fixture" add apps/server/unlisted.ts
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_MANIFEST_INCOMPLETE" ]

  make_base_fixture
  perl -0pi -e 's/ALREADY_REUSED\t\.dockerignore\tV1_SHARED_FOUNDATION\t-/ALREADY_REUSED\t.dockerignore/' \
    "$fixture/docs/verification/legacy-removal-manifest.md"
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_MANIFEST_INVALID" ]

  make_base_fixture
  perl -0pi -e 's/(<!-- INVENTORY-BEGIN -->\n)/$1ALREADY_REUSED\t.dockerignore\tV1_SHARED_FOUNDATION\t-\n/' \
    "$fixture/docs/verification/legacy-removal-manifest.md"
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_MANIFEST_DUPLICATE" ]

  make_base_fixture
  perl -0pi -e 's/PRESERVE\t(apps\/server\/src\/adapters\/postgres\/migrations\/)/REMOVE\t$1/' \
    "$fixture/docs/verification/legacy-removal-manifest.md"
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_PRESERVATION_INVALID" ]
}

@test "reviewed base fixture rejects wrong branch and dirty tracked tree without mutation" {
  make_base_fixture
  git -C "$fixture" switch -qc review-wrong-branch
  before=$(git -C "$fixture" status --porcelain=v1)
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$reviewed_hash"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_BRANCH_INVALID" ]
  [ "$(git -C "$fixture" status --porcelain=v1)" = "$before" ]

  make_base_fixture
  printf '\ntracked review dirt\n' >>"$fixture/README.md"
  before=$(git -C "$fixture" status --porcelain=v1)
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$reviewed_hash"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_TRACKED_WORKTREE_DIRTY" ]
  [ "$(git -C "$fixture" status --porcelain=v1)" = "$before" ]
}

@test "reviewed base fixture binds Task 23 evidence identity and named PASS state" {
  make_base_fixture
  printf '\ntampered identity\n' >>"$fixture/docs/verification/v1-acceptance.md"
  commit_fixture_change
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$reviewed_hash"
  [ "$status" -ne 0 ]
  [ "$output" = "TASK_23_READINESS_EVIDENCE_INVALID" ]

  make_base_fixture
  perl -0pi -e 's/(\| Default real-stack Playwright gate\s+\|[^\n]*\| )PASS(\s+\|)/$1FAIL$2/' \
    "$fixture/docs/verification/v1-merge-readiness.md"
  grep -F '| FAIL' "$fixture/docs/verification/v1-merge-readiness.md" >/dev/null
  commit_fixture_change
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$reviewed_hash"
  [ "$status" -ne 0 ]
  [ "$output" = "TASK_23_READINESS_EVIDENCE_INVALID" ]
}

@test "reviewed base fixture exposes exact path-safe git rm argv and ignores untracked serena" {
  make_base_fixture
  mkdir -p "$fixture/.serena"
  printf '%s\n' 'user-owned' >"$fixture/.serena/note"
  expected="$BATS_TEST_TMPDIR/expected-argv"
  actual="$BATS_TEST_TMPDIR/actual-argv"
  {
    printf 'ARGV\t0\tgit\n'
    printf 'ARGV\t1\t-C\n'
    printf 'ARGV\t2\t%s\n' "$fixture"
    printf 'ARGV\t3\trm\n'
    printf 'ARGV\t4\t--\n'
    awk -F '\t' '$1 == "REMOVE" { printf "ARGV\t%d\t%s\n", n++, $2 }' n=5 \
      "$fixture/docs/verification/legacy-removal-manifest.md"
  } >"$expected"

  before=$(git -C "$fixture" status --porcelain=v1)
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$reviewed_hash"
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" >"$actual"
  run diff -u "$expected" "$actual"
  [ "$status" -eq 0 ]
  [ "$(git -C "$fixture" status --porcelain=v1)" = "$before" ]
}
