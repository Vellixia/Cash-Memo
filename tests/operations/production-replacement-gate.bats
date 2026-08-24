#!/usr/bin/env bats

setup() { repo="$BATS_TEST_DIRNAME/../.."; }

@test "production replacement refuses missing preservation evidence" {
  run "$repo/scripts/production-replacement-gate.sh" --target-class production --target-id cashmemo-v1-production \
    --dokploy-service legacy --dokploy-config-digest sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    --database-name cashmemo --database-fingerprint sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  [ "$status" -ne 0 ]
}

@test "disposable isolated V1 target needs no legacy audit" {
  run "$repo/scripts/production-replacement-gate.sh" --target-class disposable-isolated-v1 --target-id v1-development-disposable
  [ "$status" -eq 0 ]
}
