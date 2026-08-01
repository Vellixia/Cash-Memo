#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "${root}"

required=(backend/crates/cashmemo apps/web/src/app specs/001-money-memo-foundation/contracts infra/compose)
for path in "${required[@]}"; do
  [[ -e "${path}" ]] || { printf 'missing required path: %s\n' "${path}" >&2; exit 1; }
done

if rg -n --glob 'Cargo.toml' --glob 'package.json' '"?(mongodb|redis|openai|whisper|sqlx|diesel|sea-orm)"?\s*[:=]' backend apps package.json; then
  printf '%s\n' 'forbidden dependency found' >&2
  exit 1
fi

if rg -n --glob '!specs/**' --glob '!docs/**' --glob '!deny.toml' --glob '!tests/architecture/repository_layout_test.sh' '(mongodb(\+srv)?://|internal MongoDB|direct MongoDB)' .; then
  printf '%s\n' 'direct Appwrite-internal database access found' >&2
  exit 1
fi

printf '%s\n' 'repository layout and dependency boundary passed'

