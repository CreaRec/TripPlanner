# Docker + GHCR deployment

Production runs as a Docker Compose stack: existing Postgres (`crea-trip-planner-db`) plus the bot image from GitHub Container Registry (GHCR). Releases happen only through GitHub Actions when changes land on `main`. There is no local deploy script.

Image: `ghcr.io/crearec/crea-trip-planner`

Deploy directory: `/home/crearec/crea-trip-planner`

## How a release works

1. Merge or push to `main`.
2. Actions runs tests and builds the image.
3. Actions pushes tags `main` and `sha-<short>` to GHCR.
4. Actions copies `docker-compose.yml` to the server, exports `IMAGE_TAG` in the SSH session (overrides `.env` for Compose interpolation), then runs `docker compose pull && docker compose up -d`.

App secrets stay on the server in `.env`. Postgres data stays in `./data/postgres`. Exports use `./data/exports`. CI never mutates `.env` and never touches Postgres volumes.

On container start the bot entrypoint runs `prisma migrate deploy`, then `node dist/index.js`.

## One-time server bootstrap

The Postgres container (`crea-trip-planner-db`) is already running in the `crea-trip-planner` stack. Do **not** create a new database or change the volume path. Add the bot to the same stack.

Use the same Linux user that already runs Docker/Portainer (`crearec`).

### 1. GitHub / GHCR

After the first successful `publish` job:

1. Open the `crea-trip-planner` package under your GitHub user/org.
2. Link it to the `TripPlanner` repository if needed.
3. Keep the package **Private**.
4. Ensure the server can pull private GHCR images (same `docker login ghcr.io` used for other bots is fine).

### 2. Deploy directory

Path: `/home/crearec/crea-trip-planner` (already has `.env`, `data/postgres`, and optionally `data/exports`).

Add to `.env` (keep existing secrets):

```sh
IMAGE=ghcr.io/crearec/crea-trip-planner
IMAGE_TAG=main
```

`DATABASE_URL` may still point at `localhost` for historical reasons; Compose overrides it for the `bot` service to use host `db`.

Ensure `data/exports` is writable by the container user (`node`, UID 1000).

Nginx OAuth snippets (if used) stay on the host and proxy to `127.0.0.1:$HTTP_PORT`. Install or refresh them manually from [`deploy/nginx/`](../deploy/nginx/) — CI does not manage nginx.

### 3. Stop the old systemd unit

```sh
sudo systemctl disable --now telegram-trip-planner
```

Later deploys also attempt this if the unit still exists.

### 4. First start

Either:

```sh
cd /home/crearec/crea-trip-planner
docker compose pull
docker compose up -d
```

Or merge to `main` and let Actions deploy.

Check Portainer (stack `crea-trip-planner` should show `crea-trip-planner-db` plus the bot), `docker compose logs -f bot`, and send a message in Telegram.

After the bot is stable, remove host `node_modules` / `dist` / the old systemd unit. **Do not** remove or recreate `data/postgres`. Never run `docker compose down -v`.

## Observability (OpenTelemetry → CreaGrafana)

Production bot containers export traces, metrics, and logs via **OTLP HTTP** to Grafana Alloy on the external Docker network `lgtm`. Do not point the bot at Loki, Tempo, or Mimir directly.

| Env | Production value |
|-----|------------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://alloy:4318` |
| `OTEL_SERVICE_NAME` | `crea-trip-planner` |
| `OTEL_SERVICE_NAMESPACE` | `bots` |
| `OTEL_SERVICE_VERSION` | `${IMAGE_TAG}` (image tag) |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | `production` |

Compose joins the `bot` service to `lgtm` (external). Prerequisite (once per host, if CreaGrafana already created it): `docker network create lgtm`.

When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (local `npm run dev` / tests), the SDK does not start.

All application logs go through `Logger` (`src/telemetry/logger.ts`): stdout for `docker compose logs`, and OTLP logs to Alloy/Loki when the SDK is running. Do not use raw `console.*` in app code.

Request chain (one Telegram update → one `trace_id`):

1. `bot.handle_update` — `request received` / `request completed` + contract metrics (`bot_updates_total`, `bot_handler_duration_seconds`; errors also increment `bot_errors_total`)
2. optional child `bot.command` — `/start` / `/help`
3. optional `bot.job.vision` — image extract
4. `bot.job.agent` — `handle start` → `llm request` / `tool.call` → `handle done`
5. optional `bot.job.gmail` — direct Gmail export
6. `bot` — `reply sent`

Contract metrics only: `bot_updates_total` (`result`), `bot_handler_duration_seconds` (`handler`, `result`), `bot_errors_total` (`error_type`, `handler`), `bot_up` (no labels). Nested `bot.job.*` spans are traces only.

Correlate in Loki by `trace_id` (or `telegram_id`). Tempo spans: `bot.handle_update` → `bot.job.agent` / `bot.job.vision` / `bot.job.gmail`.

Grafana Explore checks after deploy:

- Loki: `{service_name="crea-trip-planner"}` (filter `| telegram_id=111` or by `trace_id`)
- Tempo: search service `crea-trip-planner` / span `bot.handle_update` or `bot.job.agent`
- Mimir (fleet):

```promql
sum by (service_name) (rate(bot_updates_total{service_namespace="bots"}[5m]))
```

```promql
sum by (service_name) (rate(bot_errors_total[5m]))
```

```promql
max by (service_name) (bot_up)
```

## Day-to-day operations

Deploy: merge to `main`.

On the server (or via Portainer):

```sh
cd /home/crearec/crea-trip-planner
docker compose ps
docker compose logs -f bot
docker compose restart bot
```

## GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `DEPLOY_SSH_KEY` | Private key for SSH deploy |
| `DEPLOY_HOST` | Tailscale IP or MagicDNS hostname of the server (for example `100.118.169.52`) |
| `DEPLOY_USER` | SSH user (for example `crearec`) |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID (Trust credentials) for ephemeral CI nodes |
| `TS_OAUTH_SECRET` | Tailscale OAuth client secret (Trust credentials) |

Deploy joins the tailnet with `tag:ci` via [`tailscale/github-action`](https://github.com/tailscale/github-action), then SSHs to `DEPLOY_HOST`. Create the OAuth client under Tailscale **Settings → Trust credentials** (not legacy OAuth clients).

GHCR push uses the workflow `GITHUB_TOKEN` (`packages: write`). No extra registry secret is required for publish.

The deploy user needs Docker Compose without sudo, and passwordless sudo for `systemctl` only while the systemd unit is being retired.
