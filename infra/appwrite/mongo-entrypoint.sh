#!/bin/bash
set -euo pipefail

keyfile_path="/data/keyfile/mongo-keyfile"
if [[ ! -f "${keyfile_path}" ]]; then
  mkdir -p /data/keyfile
  openssl rand -base64 756 > "${keyfile_path}"
fi
chmod 400 "${keyfile_path}"
chown mongodb:mongodb "${keyfile_path}" 2>/dev/null || chown 999:999 "${keyfile_path}"
exec docker-entrypoint.sh mongod --replSet rs0 --bind_ip_all --auth --keyFile "${keyfile_path}"
