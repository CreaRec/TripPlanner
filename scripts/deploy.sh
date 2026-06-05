#!/usr/bin/env bash
# Deploy Crea Trip Planner to the Debian server.
#
# Syncs the project, builds it (incl. prisma generate), runs migrations, ensures
# the Postgres container is up (with mounted storage), and installs/restarts the
# systemd service that runs the Telegram bot natively.
#
# Override any of these via environment variables:
#   SERVER_HOST, SSH_USER, REMOTE_APP_DIR, SERVICE_NAME, SKIP_NGINX_WEB

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib.sh
. scripts/lib.sh

SERVER_HOST="${SERVER_HOST:-192.168.1.135}"
DEFAULT_SSH_USER="${SSH_USER:-crearec}"
SSH_USER="${SSH_USER:-$DEFAULT_SSH_USER}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/home/crearec/crea-trip-planner}"
SERVICE_NAME="${SERVICE_NAME:-telegram-trip-planner}"
SKIP_NGINX_WEB="${SKIP_NGINX_WEB:-}"

SSH_TARGET="${SSH_USER}@${SERVER_HOST}"

log "Deploying to ${SSH_TARGET}:${REMOTE_APP_DIR} (service: ${SERVICE_NAME})"

# 1. Sanity: required local tooling.
for cmd in rsync ssh; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd is required locally."
    exit 1
  fi
done

# 2. Ensure the remote app directory exists.
ssh "$SSH_TARGET" "mkdir -p '${REMOTE_APP_DIR}'"

# 3. Sync the source (exclude build artefacts, deps, data, and secrets/local env).
#    Note: prisma/ (schema + migrations) IS synced.
log "Syncing files..."
rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'data/' \
  --exclude '.env' \
  --exclude '.env.local' \
  ./ "${SSH_TARGET}:${REMOTE_APP_DIR}/"
ok "Files synced."

# 4. Warn if the remote .env is missing (never overwrite secrets).
if ! ssh "$SSH_TARGET" "test -f '${REMOTE_APP_DIR}/.env'"; then
  warn "Remote ${REMOTE_APP_DIR}/.env is MISSING."
  warn "Create it on the server (copy .env.example) before the service can start."
fi

# 5. Remote bootstrap: containers, build, migrate, systemd. Needs a tty for sudo.
#    Do not pipe the remote script on stdin — that prevents ssh -t from allocating a TTY.
log "Running remote build & service setup..."
REMOTE_SCRIPT="${REMOTE_APP_DIR}/scripts/deploy-remote.sh"
ssh -tt "$SSH_TARGET" \
  "REMOTE_APP_DIR='${REMOTE_APP_DIR}' SERVICE_NAME='${SERVICE_NAME}' DEPLOY_USER='${SSH_USER}' SKIP_NGINX_WEB='${SKIP_NGINX_WEB}' bash '${REMOTE_SCRIPT}'"

ok "Deploy complete."
