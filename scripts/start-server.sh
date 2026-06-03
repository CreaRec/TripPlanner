#!/usr/bin/env bash
# Run ON the Debian server. Prepares infrastructure for the systemd-managed bot:
# verifies Docker, ensures the Postgres container is healthy with mounted storage,
# and applies Prisma migrations. It does NOT start the bot process itself -
# that is owned by the systemd service (telegram-trip-planner).

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib.sh
. scripts/lib.sh

if [ ! -f ".env" ]; then
  err "No .env found in $(pwd). Create it before starting."
  exit 1
fi

require_docker

mkdir -p data/postgres data/exports
ensure_containers

log "Applying Prisma migrations..."
npm run migrate:deploy

ok "Infrastructure ready. The bot is managed by systemd (telegram-trip-planner)."
log "Use: sudo systemctl status telegram-trip-planner"
