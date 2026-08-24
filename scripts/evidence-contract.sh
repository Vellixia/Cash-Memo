#!/usr/bin/env bash

evidence_require_hex_key() {
  local name=$1 value=${!1:-}
  [[ $value =~ ^[a-f0-9]{64,}$ && ${#value} -le 1024 && $((${#value} % 2)) -eq 0 ]] || return 1
  printf '%s' "$value"
}

evidence_signature() {
  local evidence=$1 key=$2
  jq -S -c 'del(.signature)' -- "$evidence" | \
    openssl dgst -sha256 -mac HMAC -macopt "hexkey:$key" -binary | xxd -p -c 256
}

evidence_signature_valid() {
  local evidence=$1 key=$2 signature expected
  signature=$(jq -r '.signature // empty' -- "$evidence" 2>/dev/null) || return 1
  [[ $signature =~ ^[a-f0-9]{64}$ ]] || return 1
  expected=$(evidence_signature "$evidence" "$key") || return 1
  [[ $expected =~ ^[a-f0-9]{64}$ && $signature == "$expected" ]]
}

evidence_regular_file() {
  [[ -f $1 && ! -L $1 && -r $1 ]]
}
