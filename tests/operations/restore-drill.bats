#!/usr/bin/env bats

setup() {
  repo="$BATS_TEST_DIRNAME/../.."
  evidence="$BATS_TEST_TMPDIR/restore.json"
  key=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
  export CASHMEMO_V1_RESTORE_EVIDENCE_HMAC_KEY="$key"
  timestamp="$repo/scripts/operations/utc-timestamp.mjs"
  now=$(node "$timestamp" --now --offset-seconds 0)
  expires=$(node "$timestamp" --base "$now" --offset-seconds 600)
}

sign() {
  signature=$(jq -S -c 'del(.signature)' "$evidence" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$key" -binary | xxd -p -c 256)
  jq --arg signature "$signature" '.signature = $signature' "$evidence" >"$evidence.next"
  mv "$evidence.next" "$evidence"
}

write_restore_evidence() {
  local target_id=${1:-restore-1}
  local fresh=${2:-$now}
  jq -n --arg issued "$now" --arg expires "$expires" --arg target "$target_id" --arg fresh "$fresh" '
    {schema_version:1,evidence_id:"RR-1",issued_at:$issued,expires_at:$expires,
     target:{class:"isolated_restored_v1",id:$target},database:{name:"cashmemo_restore",fingerprint:"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
     isolation:{network_exposed:false,application_traffic_enabled:false},backup:{id:"B-1",fresh_at:$fresh},pitr:{verified:true,proof_id:"PITR-1"},
     replay_summary:{receipts_scanned:2,users_purged:1,unreadable_receipts:0,unprocessed_matches:0},
     operator:{id:"ops-1",approved_at:$issued},approval:{id:"APR-1",identity:"ops-approver",signed_at:$issued},signature:""}' >"$evidence"
  sign
}

verify() {
  "$repo/scripts/verify-restore.sh" --evidence "$evidence" --target-id restore-1 \
    --database-name cashmemo_restore --database-fingerprint sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
}

@test "restore verification refuses route exposure and unfinished replay" {
  write_restore_evidence
  jq '.isolation.network_exposed = true' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  sign
  run verify
  [ "$status" -ne 0 ]
}

@test "restore verification accepts authenticated wrapper contract" {
  write_restore_evidence
  run verify
  [ "$status" -eq 0 ]
  [ "$output" = "RESTORE_VERIFICATION_PASS" ]
}

@test "restore verification rejects unsigned forged other-target stale and incomplete evidence" {
  write_restore_evidence
  jq '.signature = "00"' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  run verify
  [ "$status" -ne 0 ]
  write_restore_evidence other-restore
  run verify
  [ "$status" -ne 0 ]
  write_restore_evidence restore-1 2020-01-01T00:00:00Z
  run verify
  [ "$status" -ne 0 ]
  write_restore_evidence
  jq 'del(.replay_summary.receipts_scanned)' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  sign
  run verify
  [ "$status" -ne 0 ]
}

@test "restore verification rejects signed expired and future-issued evidence" {
  write_restore_evidence
  issued=$(node "$timestamp" --base "$now" --offset-seconds -899)
  expired=$(node "$timestamp" --base "$now" --offset-seconds -898)
  jq --arg issued "$issued" --arg expired "$expired" '.issued_at=$issued | .expires_at=$expired | .backup.fresh_at=$issued | .operator.approved_at=$issued | .approval.signed_at=$issued' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  sign
  run verify
  [ "$status" -ne 0 ]
  issued=$(node "$timestamp" --base "$now" --offset-seconds 60)
  expires_future=$(node "$timestamp" --base "$now" --offset-seconds 120)
  jq --arg issued "$issued" --arg expires "$expires_future" '.issued_at=$issued | .expires_at=$expires | .backup.fresh_at=$issued | .operator.approved_at=$issued | .approval.signed_at=$issued' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  sign
  run verify
  [ "$status" -ne 0 ]
}

@test "restore template has exact schema and cannot pass unsigned" {
  template="$repo/docs/operations/templates/backup-restore-readiness.json"
  [ -f "$template" ]
  jq -e 'keys == ["approval","backup","database","evidence_id","expires_at","isolation","issued_at","operator","pitr","replay_summary","schema_version","signature","target"] and .schema_version == 1' "$template" >/dev/null
  run "$repo/scripts/verify-restore.sh" --evidence "$template" --target-id restore-1 --database-name cashmemo_restore --database-fingerprint sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  [ "$status" -ne 0 ]
  [ -f "$repo/docs/operations/templates/production-cutover-approval.md" ]
  [ -f "$repo/docs/operations/templates/rollback-reconciliation-decision.md" ]
  grep -F 'templates/README.md' "$repo/infra/backup/restore-runbook.md" >/dev/null
}
