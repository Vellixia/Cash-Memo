#!/usr/bin/env bats

setup() {
  repo="$BATS_TEST_DIRNAME/../.."
  manifest="$repo/docs/verification/legacy-removal-manifest.md"
  script="$repo/scripts/apply-approved-legacy-removal.sh"
  fixture_index=0
}

manifest_hash() {
  shasum -a 256 "$manifest" | cut -d' ' -f1
}

tracked_state() {
  git -C "$repo" status --porcelain=v1 --untracked-files=no
}

inventory_records() {
  awk '
    $0 == "<!-- INVENTORY-BEGIN -->" { inside=1; next }
    $0 == "<!-- INVENTORY-END -->" { inside=0; next }
    inside && NF { print }
  ' "$manifest"
}

independent_scoped_paths() {
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

make_fixture() {
  fixture_index=$((fixture_index + 1))
  fixture="$BATS_TEST_TMPDIR/repository-$fixture_index"
  git clone -q "$repo" "$fixture"
  fixture=$(cd "$fixture" && pwd -P)
  for relative in \
    docs/verification/legacy-removal-manifest.md \
    docs/verification/v1-merge-readiness.md \
    scripts/apply-approved-legacy-removal.sh \
    scripts/preservation-audit.sh; do
    cp "$repo/$relative" "$fixture/$relative"
  done
  git -C "$fixture" add .
  if ! git -C "$fixture" diff --cached --quiet; then
    git -C "$fixture" -c user.name=test -c user.email=test@example.invalid commit -qm fixture-overlay
  fi
}

fixture_hash() {
  shasum -a 256 "$fixture/docs/verification/legacy-removal-manifest.md" | cut -d' ' -f1
}

commit_fixture_change() {
  git -C "$fixture" add .
  git -C "$fixture" -c user.name=test -c user.email=test@example.invalid commit -qm fixture-tamper
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
  expected="$BATS_TEST_TMPDIR/expected"
  actual="$BATS_TEST_TMPDIR/actual"
  independent_scoped_paths >"$expected"
  inventory_records | cut -f2 | LC_ALL=C sort >"$actual"

  run diff -u "$expected" "$actual"
  [ "$status" -eq 0 ]

  run awk -F '\t' '
    NF != 4 { exit 1 }
    $1 != "REMOVE" && $1 != "PRESERVE" && $1 != "ALREADY_REUSED" { exit 1 }
    seen[$2]++ { exit 1 }
    $2 == "" || $2 ~ /^\// || $2 ~ /(^|\/)\.\.($|\/)/ || $2 ~ /[*?]/ || index($2, "[") { exit 1 }
    $3 == "" || $4 == "" { exit 1 }
  ' < <(inventory_records)
  [ "$status" -eq 0 ]
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
  make_fixture
  printf '%s\n' 'new legacy file' >"$fixture/apps/server/unlisted.ts"
  git -C "$fixture" add apps/server/unlisted.ts

  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$(fixture_hash)"

  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_MANIFEST_INCOMPLETE" ]
}

@test "malformed and duplicate inventory records fail closed" {
  make_fixture
  perl -0pi -e 's/ALREADY_REUSED\t\.dockerignore\tV1_SHARED_FOUNDATION\t-/ALREADY_REUSED\t.dockerignore/' \
    "$fixture/docs/verification/legacy-removal-manifest.md"
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_MANIFEST_INVALID" ]

  make_fixture
  perl -0pi -e 's/(<!-- INVENTORY-BEGIN -->\n)/$1ALREADY_REUSED\t.dockerignore\tV1_SHARED_FOUNDATION\t-\n/' \
    "$fixture/docs/verification/legacy-removal-manifest.md"
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_MANIFEST_DUPLICATE" ]
}

@test "preservation classification tampering fails closed" {
  make_fixture
  perl -0pi -e 's/PRESERVE\t(apps\/server\/src\/adapters\/postgres\/migrations\/)/REMOVE\t$1/' \
    "$fixture/docs/verification/legacy-removal-manifest.md"

  run "$fixture/scripts/apply-approved-legacy-removal.sh" --check "$(fixture_hash)"

  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_PRESERVATION_INVALID" ]
}

@test "apply preflight rejects wrong branch and dirty tracked tree without mutation" {
  make_fixture
  git -C "$fixture" switch -qc review-wrong-branch
  before=$(git -C "$fixture" status --porcelain=v1)
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_BRANCH_INVALID" ]
  [ "$(git -C "$fixture" status --porcelain=v1)" = "$before" ]

  make_fixture
  printf '\ntracked review dirt\n' >>"$fixture/README.md"
  before=$(git -C "$fixture" status --porcelain=v1)
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "LEGACY_REMOVAL_TRACKED_WORKTREE_DIRTY" ]
  [ "$(git -C "$fixture" status --porcelain=v1)" = "$before" ]
}

@test "Task 23 evidence identity and named PASS state are fail closed" {
  make_fixture
  printf '\ntampered identity\n' >>"$fixture/docs/verification/v1-acceptance.md"
  commit_fixture_change
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "TASK_23_READINESS_EVIDENCE_INVALID" ]

  make_fixture
  perl -0pi -e 's/(\| Default real-stack Playwright gate\s+\|[^\n]*\| )PASS(\s+\|)/$1FAIL$2/' \
    "$fixture/docs/verification/v1-merge-readiness.md"
  grep -F '| FAIL' "$fixture/docs/verification/v1-merge-readiness.md" >/dev/null
  commit_fixture_change
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$(fixture_hash)"
  [ "$status" -ne 0 ]
  [ "$output" = "TASK_23_READINESS_EVIDENCE_INVALID" ]
}

@test "non-mutating plan exposes exact path-safe git rm argv and ignores untracked serena" {
  make_fixture
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
  run "$fixture/scripts/apply-approved-legacy-removal.sh" --plan "$(fixture_hash)"
  [ "$status" -eq 0 ]
  printf '%s\n' "$output" >"$actual"
  run diff -u "$expected" "$actual"
  [ "$status" -eq 0 ]
  [ "$(git -C "$fixture" status --porcelain=v1)" = "$before" ]
}
