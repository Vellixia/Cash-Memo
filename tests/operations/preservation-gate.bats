#!/usr/bin/env bats

setup() {
  repo="$BATS_TEST_DIRNAME/../.."
  evidence="$BATS_TEST_TMPDIR/evidence.json"
  key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  export CASHMEMO_V1_PRESERVATION_EVIDENCE_HMAC_KEY="$key"
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  expires=$(date -u -v+10M +%Y-%m-%dT%H:%M:%SZ)
}

sign() {
  signature=$(jq -S -c 'del(.signature)' "$evidence" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$key" -binary | xxd -p -c 256)
  jq --arg signature "$signature" '.signature = $signature' "$evidence" >"$evidence.next"
  mv "$evidence.next" "$evidence"
}

write_evidence() {
  local target_id=${1:-cashmemo-v1-production}
  local rows=${2:-0}
  local real=${3:-false}
  local disposition=${4:-empty_database}
  local fresh=${5:-$now}
  jq -n --arg issued "$now" --arg expires "$expires" --arg target "$target_id" --arg fresh "$fresh" \
    --arg disposition "$disposition" --argjson rows "$rows" --argjson real "$real" '
    {schema_version:1,evidence_id:"EV-1",issued_at:$issued,expires_at:$expires,
     target:{class:"production",id:$target},dokploy:{service:"legacy",config_digest:"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
     database:{name:"cashmemo",fingerprint:"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
     table_row_inventory:{complete:true,tables:[{table:"sessions",rows:0},{table:"users",rows:$rows}]},
     backup:{id:"B-1",fresh_at:$fresh},real_user_data:$real,disposition:$disposition,
     operator:{id:"ops-1",approved_at:$issued},approval:{id:"APR-1",identity:"ops-approver",signed_at:$issued},signature:""}' >"$evidence"
  sign
}

audit() {
  "$repo/scripts/preservation-audit.sh" --evidence "$evidence" --target-class production \
    --target-id cashmemo-v1-production --dokploy-service legacy \
    --dokploy-config-digest sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    --database-name cashmemo --database-fingerprint sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
}

@test "preservation audit fails closed when required evidence is absent" {
  run audit
  [ "$status" -ne 0 ]
}

@test "preservation audit stops real user data" {
  write_evidence cashmemo-v1-production 1 true real_user_data_requires_migration
  run audit
  [ "$status" -ne 0 ]
  [ "$output" = "STOP_REQUIRES_DEDICATED_MIGRATION_PLAN" ]
}

@test "preservation audit accepts authenticated bound empty-target evidence" {
  write_evidence
  run audit
  [ "$status" -eq 0 ]
  [ "$output" = "PRESERVATION_AUDIT_PASS" ]
}

@test "preservation audit rejects forged signature" {
  write_evidence
  jq '.target.id = "other"' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  run audit
  [ "$status" -ne 0 ]
}

@test "preservation audit rejects signed evidence replayed for another target" {
  write_evidence other-production
  run audit
  [ "$status" -ne 0 ]
}

@test "preservation audit rejects stale backup and malformed row inventory" {
  write_evidence cashmemo-v1-production 0 false empty_database 2020-01-01T00:00:00Z
  run audit
  [ "$status" -ne 0 ]
  write_evidence
  jq '.table_row_inventory.tables[1].rows = 1.5' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  sign
  run audit
  [ "$status" -ne 0 ]
}

@test "preservation audit rejects nonzero development data without explicit disposition" {
  write_evidence cashmemo-v1-production 1 false empty_database
  run audit
  [ "$status" -ne 0 ]
}

@test "preservation audit rejects signed expired and future-issued evidence" {
  write_evidence
  issued=$(date -u -v-899S +%Y-%m-%dT%H:%M:%SZ)
  expired=$(date -u -v-898S +%Y-%m-%dT%H:%M:%SZ)
  jq --arg issued "$issued" --arg expired "$expired" '.issued_at=$issued | .expires_at=$expired | .backup.fresh_at=$issued | .operator.approved_at=$issued | .approval.signed_at=$issued' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  sign
  run audit
  [ "$status" -ne 0 ]
  issued=$(date -u -v+60S +%Y-%m-%dT%H:%M:%SZ)
  expires_future=$(date -u -v+120S +%Y-%m-%dT%H:%M:%SZ)
  jq --arg issued "$issued" --arg expires "$expires_future" '.issued_at=$issued | .expires_at=$expires | .backup.fresh_at=$issued | .operator.approved_at=$issued | .approval.signed_at=$issued' "$evidence" >"$evidence.next" && mv "$evidence.next" "$evidence"
  sign
  run audit
  [ "$status" -ne 0 ]
}

@test "preservation template has exact schema and cannot pass unsigned" {
  template="$repo/docs/operations/templates/preservation-decision.json"
  [ -f "$template" ]
  jq -e 'keys == ["approval","backup","database","disposition","dokploy","evidence_id","expires_at","issued_at","operator","real_user_data","schema_version","signature","table_row_inventory","target"] and .schema_version == 1' "$template" >/dev/null
  grep -F 'templates/README.md' "$repo/docs/operations/preservation-gate.md" >/dev/null
  run "$repo/scripts/preservation-audit.sh" --evidence "$template" --target-class production --target-id cashmemo-v1-production --dokploy-service legacy --dokploy-config-digest sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --database-name cashmemo --database-fingerprint sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  [ "$status" -ne 0 ]
}
