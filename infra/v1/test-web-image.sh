#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 IMAGE" >&2
  exit 2
fi

image=$1
container="cashmemo-web-contract-$$"
port=''

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Runtime assertions ($image):"
docker run --rm "$image" sh -c '
set -e
command -v node
! command -v npm
! command -v npx
! command -v corepack
! test -e /usr/local/lib/node_modules/npm/package.json
! test -e /usr/local/lib/node_modules/corepack/package.json
test "$(id -u)" -ne 0
node --version
'

if docker run --rm "$image" sh -c 'command -v npm >/dev/null 2>&1 || command -v npx >/dev/null 2>&1 || command -v corepack >/dev/null 2>&1 || test -e /usr/local/lib/node_modules/npm/package.json || test -e /usr/local/lib/node_modules/corepack/package.json'; then
  echo "Package-manager command or manifest still present" >&2
  exit 1
fi

container=$(docker run -d --rm --name "$container" -p 127.0.0.1::3000 "$image" node apps/web/server.js)
port=$(docker port "$container" 3000/tcp | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
if [[ -z "$port" ]]; then
  echo "Could not discover published HTTP port" >&2
  docker logs "$container" >&2 || true
  exit 1
fi

http_ok=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --location "http://127.0.0.1:$port/" >/dev/null; then
    http_ok=1
    break
  fi
  sleep 1
done
if [[ "$http_ok" -ne 1 ]]; then
  echo "Standalone server did not return successful HTTP response" >&2
  docker logs "$container" >&2 || true
  exit 1
fi
echo "HTTP GET /: PASS (200 after redirects)"

image_id=$(docker image inspect --format '{{.Id}}' "$image")
repo_digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null || true)
if [[ -z "$repo_digest" || "$repo_digest" == '<no value>' ]]; then
  repo_digest="$image@$image_id"
fi
echo "IMAGE_DIGEST=$repo_digest"
echo "IMAGE_ID=$image_id"
