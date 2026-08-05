#!/usr/bin/env bash
set -euo pipefail

if [[ "${CASHMEMO_SKIP_ACCEPTANCE_BUILD:-0}" != "1" ]]; then
  npm run build --workspace @cashmemo/web
fi
mkdir -p apps/web/.next/standalone/apps/web/.next
cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/
cp -R apps/web/public apps/web/.next/standalone/apps/web/

export HOSTNAME="127.0.0.1"
export PORT="3100"
exec node apps/web/.next/standalone/apps/web/server.js
