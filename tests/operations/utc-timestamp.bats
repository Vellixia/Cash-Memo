#!/usr/bin/env bats

setup() {
  repo="$BATS_TEST_DIRNAME/../.."
}

timestamp() {
  node "$repo/scripts/operations/utc-timestamp.mjs" "$@"
}

@test "UTC timestamp adds signed integer seconds to explicit RFC3339 base" {
  run timestamp --base 2026-08-25T00:00:00Z --offset-seconds 600
  [ "$status" -eq 0 ]
  [ "$output" = "2026-08-25T00:10:00Z" ]

  run timestamp --base 2026-01-01T00:00:00Z --offset-seconds -1
  [ "$status" -eq 0 ]
  [ "$output" = "2025-12-31T23:59:59Z" ]
}

@test "UTC timestamp accepts only exact UTC seconds and round-trips dates" {
  run timestamp --base 2026-08-25T00:00:00Z --offset-seconds 0
  [ "$status" -eq 0 ]
  [ "$output" = "2026-08-25T00:00:00Z" ]

  for base in \
    2026-08-25T00:00:00+00:00 \
    2026-08-25T00:00:00.000Z \
    2026-02-29T00:00:00Z \
    2026-13-01T00:00:00Z \
    malformed; do
    run timestamp --base "$base" --offset-seconds 0
    [ "$status" -ne 0 ]
  done
}

@test "UTC timestamp rejects invalid mode and offset arguments" {
  run timestamp --base 2026-08-25T00:00:00Z --now --offset-seconds 0
  [ "$status" -ne 0 ]

  run timestamp --offset-seconds 0
  [ "$status" -ne 0 ]

  run timestamp --base 2026-08-25T00:00:00Z
  [ "$status" -ne 0 ]

  for offset in 1.5 1e3 nope ''; do
    run timestamp --base 2026-08-25T00:00:00Z --offset-seconds "$offset"
    [ "$status" -ne 0 ]
  done
}

@test "UTC timestamp rejects overflow after checked second addition" {
  run timestamp --base 9999-12-31T23:59:59Z --offset-seconds 1
  [ "$status" -ne 0 ]

  run timestamp --base 0000-01-01T00:00:00Z --offset-seconds -1
  [ "$status" -ne 0 ]

  run timestamp --base 2026-08-25T00:00:00Z --offset-seconds 9007199254740992
  [ "$status" -ne 0 ]
}

@test "UTC timestamp supports now mode with strict UTC seconds output" {
  run timestamp --now --offset-seconds 0
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}
