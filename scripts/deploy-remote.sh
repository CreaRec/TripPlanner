#!/usr/bin/env bash
# Remote deploy steps (run on the server via scripts/deploy.sh).
# Expects: REMOTE_APP_DIR, SERVICE_NAME, DEPLOY_USER; optional SKIP_NGINX_WEB=1.

set -euo pipefail

: "${REMOTE_APP_DIR:?REMOTE_APP_DIR is required}"
: "${SERVICE_NAME:?SERVICE_NAME is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"

cd "$REMOTE_APP_DIR"

# Probe passwordless sudo with commands allowed by deploy sudoers.
sudo_probe() {
  sudo -n mkdir -p /etc/nginx/snippets >/dev/null 2>&1 || \
    sudo -n systemctl --version >/dev/null 2>&1 || \
    sudo -n cp --version >/dev/null 2>&1
}

is_interactive_deploy() {
  [ -t 0 ] && [ -t 1 ] && \
    [ "${CI:-}" != true ] && [ "${GITHUB_ACTIONS:-}" != true ]
}

# Reuse one sudo authentication for nginx/systemd steps (avoids repeated password prompts).
start_sudo_keepalive() {
  while true; do
    sudo_probe || exit
    sleep 50
    kill -0 "$$" || exit
  done 2>/dev/null &
  SUDO_KEEPALIVE_PID=$!
  trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null' EXIT
}

if ! sudo_probe; then
  if [ -n "${DEPLOY_PASSWORD:-}" ]; then
    printf '%s\n' "$DEPLOY_PASSWORD" | sudo -S -v
    start_sudo_keepalive
  elif is_interactive_deploy; then
    echo "[remote] sudo required for nginx/systemd setup (enter password once)..."
    sudo -v
    start_sudo_keepalive
  else
    echo "[remote] ERROR: passwordless sudo is required for non-interactive deploy (CI)." >&2
    echo "[remote] Running as: $(whoami) (expected deploy user: ${DEPLOY_USER})" >&2
    echo "[remote] sudo -n mkdir -p /etc/nginx/snippets:" >&2
    sudo -n mkdir -p /etc/nginx/snippets 2>&1 >&2 || true
    echo "[remote] sudo -n systemctl --version:" >&2
    sudo -n systemctl --version 2>&1 >&2 || true
    echo "[remote] sudo -n cp --version:" >&2
    sudo -n cp --version 2>&1 >&2 || true
    NGINX_BIN=""
    if command -v nginx >/dev/null 2>&1; then
      NGINX_BIN="$(command -v nginx)"
    elif [ -x /usr/sbin/nginx ]; then
      NGINX_BIN="/usr/sbin/nginx"
    fi
    if [ -n "$NGINX_BIN" ]; then
      echo "[remote] sudo -n ${NGINX_BIN} -t:" >&2
      sudo -n "$NGINX_BIN" -t 2>&1 >&2 || true
    fi
    echo "[remote] Fix: create /etc/sudoers.d/${DEPLOY_USER}-deploy with NOPASSWD for cp, mkdir, systemctl, journalctl, nginx." >&2
    echo "[remote] The username in sudoers must match DEPLOY_USER exactly. See README.md (GitHub Actions CI/CD)." >&2
    exit 1
  fi
fi

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

  echo "[remote] installing nginx snippet for /trip-planner/oauth/ (HTTP_PORT from .env)..."
  HTTP_PORT="3000"
  if [ -f "${REMOTE_APP_DIR}/.env" ]; then
    ENV_PORT="$(grep -E '^HTTP_PORT=' "${REMOTE_APP_DIR}/.env" | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
    if [ -n "${ENV_PORT}" ]; then
      HTTP_PORT="${ENV_PORT}"
    fi
  fi
  TMP_OAUTH="$(mktemp)"
  sed -e "s#__HTTP_PORT__#${HTTP_PORT}#g" deploy/nginx/trip-planner-oauth.conf > "$TMP_OAUTH"
  sudo cp "$TMP_OAUTH" /etc/nginx/snippets/crea-trip-planner-oauth.conf
  rm -f "$TMP_OAUTH"
  echo "[remote] OAuth proxy targets 127.0.0.1:${HTTP_PORT} — ensure HTTPS server block includes:"
  echo "[remote]   include /etc/nginx/snippets/crea-trip-planner-oauth.conf;"

  NGINX_BIN=""
  if command -v nginx >/dev/null 2>&1; then
    NGINX_BIN="$(command -v nginx)"
  elif [ -x /usr/sbin/nginx ]; then
    NGINX_BIN="/usr/sbin/nginx"
  fi

  if ! grep -rq "crea-trip-planner-oauth.conf" /etc/nginx 2>/dev/null; then
    echo "[remote] WARN: crea-trip-planner-oauth.conf is NOT included in any nginx config."
    echo "[remote] WARN: /trip-planner/oauth/* will 404 until you add the include and reload nginx."
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
