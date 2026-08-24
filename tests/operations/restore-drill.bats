#!/usr/bin/env bats

setup() { repo="$BATS_TEST_DIRNAME/../.."; evidence="$BATS_TEST_TMPDIR/restore.json"; }

@test "restore verification refuses route exposure and unfinished replay" {
  cat >"$evidence" <<'JSON'
{"target_class":"isolated_restored_v1","network_exposed":true,"backup_id":"synthetic","replay_summary":{"unreadable_receipts":1,"unprocessed_matches":0}}
JSON
  run "$repo/scripts/verify-restore.sh" --evidence "$evidence"
  [ "$status" -ne 0 ]
}
