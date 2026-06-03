#!/usr/bin/env bash
# Shared helpers for the Crea Trip Planner scripts.

set -euo pipefail

# --- logging ---------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET="\033[0m"; C_BLUE="\033[34m"; C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"
else
  C_RESET=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi

log()  { printf "${C_BLUE}[trip]${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}[ok]${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}[warn]${C_RESET} %s\n" "$*"; }
err()  { printf "${C_RED}[err]${C_RESET} %s\n" "$*" >&2; }

# --- compose helper --------------------------------------------------------
# Resolve `docker compose` vs legacy `docker-compose`.
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

# --- docker checks ---------------------------------------------------------
require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    err "docker is not installed or not on PATH."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    err "Docker daemon is not running. Start Docker and retry."
    exit 1
  fi
  ok "Docker daemon is running."
}

# Bring up the compose stack (idempotent) and wait until the db is healthy.
ensure_containers() {
  log "Ensuring containers are up..."
  compose up -d
  wait_db_healthy
}

# Wait until the `db` service reports healthy (via docker healthcheck).
wait_db_healthy() {
  local cid
  cid="$(compose ps -q db)"
  if [ -z "$cid" ]; then
    err "Could not find the 'db' container."
    exit 1
  fi
  log "Waiting for Postgres to become healthy..."
  for _ in $(seq 1 60); do
    local status
    status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "starting")"
    if [ "$status" = "healthy" ]; then
      ok "Postgres is healthy."
      return 0
    fi
    sleep 2
  done
  err "Postgres did not become healthy in time."
  compose logs --tail 50 db || true
  exit 1
}
