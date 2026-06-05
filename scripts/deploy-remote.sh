#!/usr/bin/env bash
# Remote deploy steps (run on the server via scripts/deploy.sh).
# Expects: REMOTE_APP_DIR, SERVICE_NAME, DEPLOY_USER; optional SKIP_NGINX_WEB=1.

set -euo pipefail

: "${REMOTE_APP_DIR:?REMOTE_APP_DIR is required}"
: "${SERVICE_NAME:?SERVICE_NAME is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"

cd "$REMOTE_APP_DIR"

echo "[remote] verifying static web pages..."
for f in web/trip-planner/index.html web/trip-planner/privacy/index.html web/trip-planner/terms/index.html; do
  if [ ! -f "$f" ]; then
    echo "[remote] ERROR: missing required static file: $f"
    exit 1
  fi
done

if [ "${SKIP_NGINX_WEB:-}" = "1" ]; then
  echo "[remote] SKIP_NGINX_WEB=1 — skipping nginx snippet install/reload."
else
  echo "[remote] installing nginx snippet for /trip-planner/..."
  TMP_SNIPPET="$(mktemp)"
  sed -e "s#__APP_DIR__#${REMOTE_APP_DIR}#g" deploy/nginx/trip-planner-static.conf > "$TMP_SNIPPET"
  sudo mkdir -p /etc/nginx/snippets
  sudo cp "$TMP_SNIPPET" /etc/nginx/snippets/crea-trip-planner-static.conf
  rm -f "$TMP_SNIPPET"

  NGINX_BIN=""
  if command -v nginx >/dev/null 2>&1; then
    NGINX_BIN="$(command -v nginx)"
  elif [ -x /usr/sbin/nginx ]; then
    NGINX_BIN="/usr/sbin/nginx"
  fi

  if [ -n "$NGINX_BIN" ]; then
    if sudo "$NGINX_BIN" -t 2>/dev/null; then
      if sudo systemctl reload nginx 2>/dev/null; then
        echo "[remote] nginx reloaded."
      elif sudo "$NGINX_BIN" -s reload 2>/dev/null; then
        echo "[remote] nginx reloaded (nginx -s reload)."
      else
        echo "[remote] WARN: nginx config OK but reload failed. Reload nginx manually."
      fi
    else
      echo "[remote] WARN: nginx -t failed. Fix config or add include in your server block:"
      echo "[remote]   include /etc/nginx/snippets/crea-trip-planner-static.conf;"
    fi
  else
    echo "[remote] WARN: nginx not found. Install nginx and include the snippet (see web/README.md)."
  fi
fi

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
