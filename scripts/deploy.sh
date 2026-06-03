#!/usr/bin/env bash
# Deploy Crea Trip Planner to the Debian server.
#
# Syncs the project, builds it (incl. prisma generate), runs migrations, ensures
# the Postgres container is up (with mounted storage), and installs/restarts the
# systemd service that runs the Telegram bot natively.
#
# Override any of these via environment variables:
#   SERVER_HOST, SSH_USER, REMOTE_APP_DIR, SERVICE_NAME

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib.sh
. scripts/lib.sh

SERVER_HOST="${SERVER_HOST:-192.168.1.135}"
DEFAULT_SSH_USER="${SSH_USER:-crearec}"
SSH_USER="${SSH_USER:-$DEFAULT_SSH_USER}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/home/crearec/crea-trip-planner}"
SERVICE_NAME="${SERVICE_NAME:-telegram-trip-planner}"

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
log "Running remote build & service setup..."
ssh -t "$SSH_TARGET" "REMOTE_APP_DIR='${REMOTE_APP_DIR}' SERVICE_NAME='${SERVICE_NAME}' DEPLOY_USER='${SSH_USER}' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_APP_DIR"

echo "[remote] ensuring data directories..."
mkdir -p data/postgres data/exports

echo "[remote] starting Postgres container..."
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi
$DC up -d

echo "[remote] waiting for Postgres health..."
CID="$($DC ps -q db)"
for _ in $(seq 1 60); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' "$CID" 2>/dev/null || echo starting)"
  [ "$STATUS" = "healthy" ] && break
  sleep 2
done

echo "[remote] installing dependencies..."
npm ci || npm install

echo "[remote] building (prisma generate + tsc)..."
npm run build

echo "[remote] applying Prisma migrations..."
npm run migrate:deploy

echo "[remote] installing systemd unit ${SERVICE_NAME}..."
TMP_UNIT="$(mktemp)"
sed -e "s#__USER__#${DEPLOY_USER}#g" \
    -e "s#__APP_DIR__#${REMOTE_APP_DIR}#g" \
    deploy/telegram-trip-planner.service > "$TMP_UNIT"
sudo cp "$TMP_UNIT" "/etc/systemd/system/${SERVICE_NAME}.service"
rm -f "$TMP_UNIT"

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"

echo "[remote] service status:"
sudo systemctl --no-pager --full status "${SERVICE_NAME}" || true
echo "[remote] recent logs:"
sudo journalctl -u "${SERVICE_NAME}" -n 30 --no-pager || true
REMOTE

ok "Deploy complete."
