#!/usr/bin/env bats

setup() { repo="$BATS_TEST_DIRNAME/../.."; }

@test "replay wrapper requires isolated acknowledgement and narrow credentials" {
  run env -u CASHMEMO_V1_RESTORED_DATABASE_ISOLATED -u CASHMEMO_V1_RECEIPT_CREDENTIAL_SCOPE "$repo/scripts/replay-deletion-receipts.sh"
  [ "$status" -ne 0 ]
}
