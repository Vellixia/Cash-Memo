#!/usr/bin/env bats

setup() { repo="$BATS_TEST_DIRNAME/../.."; evidence="$BATS_TEST_TMPDIR/evidence.json"; }

@test "preservation audit fails closed when required evidence is absent" {
  run "$repo/scripts/preservation-audit.sh" --evidence "$evidence"
  [ "$status" -ne 0 ]
}

@test "preservation audit stops real user data" {
  cat >"$evidence" <<'JSON'
{"operator_id":"ops-1","dokploy_inventory":{"service":"legacy","config_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"actual_database":{"name":"cashmemo","fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"table_row_evidence":{"users":1},"backup_inventory":{"latest_backup":"synthetic","fresh_at":"2026-08-21T00:00:00Z"},"evidence_expires_at":"2099-01-01T00:00:00Z","real_user_data":true,"approval_record":{"id":"APR-1","signed_by":"ops-1","signed_at":"2026-08-21T00:00:00Z"}}
JSON
  run "$repo/scripts/preservation-audit.sh" --evidence "$evidence"
  [ "$status" -ne 0 ]
  [ "$output" = "STOP_REQUIRES_DEDICATED_MIGRATION_PLAN" ]
}

@test "preservation audit rejects stale evidence" {
  cat >"$evidence" <<'JSON'
{"operator_id":"ops-1","dokploy_inventory":{"service":"legacy","config_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"actual_database":{"name":"cashmemo","fingerprint":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"table_row_evidence":{"users":0},"backup_inventory":{"latest_backup":"synthetic","fresh_at":"2026-08-21T00:00:00Z"},"evidence_expires_at":"2020-01-01T00:00:00Z","real_user_data":false,"approval_record":{"id":"APR-1","signed_by":"ops-1","signed_at":"2026-08-21T00:00:00Z"}}
JSON
  run "$repo/scripts/preservation-audit.sh" --evidence "$evidence"
  [ "$status" -ne 0 ]
}
