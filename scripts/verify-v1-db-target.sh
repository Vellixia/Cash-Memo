#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

: "${CASHMEMO_V1_DATABASE_URL:?CASHMEMO_V1_DATABASE_URL is required}"
cargo run -p cashmemo-api -- migrate
