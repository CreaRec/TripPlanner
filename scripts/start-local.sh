#!/usr/bin/env bash
# Local development: boot Postgres in Docker, apply Prisma migrations, start the bot with reload.

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib.sh
. scripts/lib.sh

if [ ! -f ".env" ]; then
  err "No .env found. Copy .env.example to .env and fill it in first."
  exit 1
fi

require_docker

# Make sure persistent data directories exist before mounting them.
mkdir -p data/postgres data/exports
ok "Data directories ready (data/postgres, data/exports)."

ensure_containers

log "Installing dependencies (npm install)..."
npm install

log "Generating Prisma client..."
npm run generate

log "Applying database migrations..."
npm run migrate:deploy

ok "Starting bot in watch mode. Press Ctrl-C to stop (containers keep running)."
npm run dev
