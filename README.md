# Crea Trip Planner

A local-first AI travel-planning agent with a **Telegram bot** frontend.

It remembers your preferences and constraints, builds and adjusts day-by-day itineraries,
saves places, and exports plans to PDF/CSV. Everything runs on your own hardware: a single
Node.js/TypeScript process (the bot + agent) talks to a **PostgreSQL + pgvector** database
running in Docker, and to the **OpenAI API** for reasoning, embeddings, and memory extraction.

The database schema and migrations are managed by **Prisma**, which is also the runtime query
layer. Vector inserts and similarity search use raw SQL because pgvector columns are
`Unsupported` in Prisma's typed client.

```
Telegram  <->  Bot/Agent (Node + TS + Prisma)  <->  Postgres + pgvector (Docker)
                      |
                      +-->  OpenAI API (chat + embeddings)
                      +-->  Google Places API (optional place enrichment)
                      +-->  Gmail API via OAuth (optional per-user email search)
                      +-->  ./data/exports (PDF / CSV)
                      +-->  HTTPS /trip-planner/oauth/* (optional OAuth callback)
```

## Features (MVP)

- Trips: create, list, select an active trip.
- Chat: free-text conversation with a tool-calling planning agent.
- Memory: structured, embedded memories (preferences, constraints, decisions) retrieved via semantic search.
- Places: save points of interest with category, notes, kid-friendly flag, and optional Google Places enrichment.
- Itinerary: day-by-day plans with ordered items.
- Export: generate PDF and CSV of an itinerary, delivered as Telegram documents.
- Gmail (optional): connect one or more Gmail inboxes, search trip/booking emails, export a message as PDF on request.

Deferred (not in MVP): KML export, web search, auto-booking, Redis cache/jobs.

## Requirements

- Node.js >= 20
- Docker + Docker Compose
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An OpenAI API key
- Optional: a Google Maps Platform key (Places API (New), Routes, Static Maps, Weather as needed)
- Optional: Gmail OAuth credentials (Gmail API + OAuth Web client) for per-user email search

## Gmail integration (optional)

1. In Google Cloud: enable **Gmail API**, add scope `https://www.googleapis.com/auth/gmail.readonly` on the OAuth consent screen, create an OAuth **Web** client with redirect URI `https://<your-domain>/trip-planner/oauth/google/callback`.
2. Set in `.env`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `PUBLIC_APP_URL`, `OAUTH_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`), `HTTP_PORT` (default `3000`).
3. In your HTTPS nginx `server { }` block include both snippets (deploy installs them under `/etc/nginx/snippets/`):

   ```nginx
   include /etc/nginx/snippets/crea-trip-planner-static.conf;
   include /etc/nginx/snippets/crea-trip-planner-oauth.conf;
   ```

4. Apply the Prisma migration that adds `gmail_accounts` and `oauth_states`.
5. In Telegram: say "connect gmail" or "подключить почту" → open the link → allow access. Repeat to add more inboxes. Ask "which inboxes are connected?" to list linked mailboxes.

While the OAuth app is in **Testing**, add each Google account email under **Test users** in Google Cloud.

Email export renders the message HTML to PDF via system Chromium. On the server install `chromium` (Debian: `sudo apt install chromium`) and set `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` if needed. Separate file attachments (non-inline) are not included in the PDF; remote images require outbound network during render.

Smoke test on the server:

```bash
chromium --headless --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --print-to-pdf=/tmp/test.pdf https://example.com && ls -lh /tmp/test.pdf
```

## Setup

1. Copy the env template and fill it in:

   ```bash
   cp .env.example .env
   # edit .env: TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, ALLOWED_TELEGRAM_IDS
   ```

   Find your numeric Telegram ID via [@userinfobot](https://t.me/userinfobot) and put it in
   `ALLOWED_TELEGRAM_IDS` (comma-separated for multiple people).

   To enrich saved places with addresses, coordinates, maps links, websites, hours/ratings, and
   booking or ticket advice, set `GOOGLE_MAPS_API_KEY`. In Google Cloud, enable the APIs you
   need (Places, Routes, Static Maps, Weather), restrict the key, and set a small budget alert.
   Weather is fetched only when you ask the bot about conditions or a forecast.

2. Start everything locally (boots Postgres in Docker, applies Prisma migrations, starts the bot in watch mode):

   ```bash
   ./scripts/start-local.sh
   ```

## Database (Prisma)

- The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma).
- Migrations are committed under `prisma/migrations/` and applied with `prisma migrate deploy`.
- To change the schema during development: edit `schema.prisma`, then run `npm run migrate:dev -- --name <change>`.
  - Caveat: the `memories.embedding` pgvector column and its ivfflat index are not Prisma-managed
    (they live in raw migration SQL). Review generated migrations so they do not drop the vector index.

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/start-local.sh` | Local dev: bring up Docker Postgres, generate client, migrate, run the bot with reload. |
| `scripts/start-server.sh` | On the server: verify Docker, ensure the DB container is healthy, run `prisma migrate deploy`. The bot itself is managed by systemd. |
| `scripts/deploy.sh` | Run tests locally, then sync the project to the Debian server, build (incl. `prisma generate`), migrate, install/restart the `telegram-trip-planner` systemd service. Aborts if tests fail. |

## Tests

Unit tests use [Vitest](https://vitest.dev) and run fully offline (no Docker, no API keys) by
mocking Prisma, OpenAI, and Telegraf at the module boundary.

```bash
npm test          # run once
npm run test:watch
```

Tests are colocated as `src/**/*.test.ts` and are excluded from the production `tsc` build.

## Persistence

PostgreSQL data is bind-mounted to `./data/postgres`, so `docker compose down` and container
recreation never wipe the database. Generated exports live in `./data/exports`. The whole
`data/` directory is gitignored.

## Deployment (Debian server)

The bot runs as a native **systemd** service (`telegram-trip-planner`); only Postgres runs in Docker.

```bash
# from your dev machine
SERVER_HOST=192.168.1.135 SSH_USER=crearec ./scripts/deploy.sh
```

Override any of: `SERVER_HOST`, `SSH_USER`, `REMOTE_APP_DIR`, `SERVICE_NAME`.

Set optional `DEPLOY_PASSWORD` in local `.env` (or export it) to skip SSH/sudo prompts during
deploy; you need `sshpass` installed locally. When `DEPLOY_PASSWORD` is unset, deploy asks for
passwords interactively.

The deploy script reuses one SSH connection and one `sudo` session on the server, so you should
only be prompted for the server login password once and the sudo password once (if password auth
is used). For zero prompts, use SSH keys and passwordless sudo for the deploy user, or
`DEPLOY_PASSWORD` with `sshpass`.

Make sure `.env` exists in `REMOTE_APP_DIR` on the server (the deploy script never overwrites it).

## Project layout

```
docker-compose.yml          Postgres + pgvector service
prisma/schema.prisma        Schema (source of truth) + vector extension
prisma/migrations/          Committed Prisma migrations
src/config.ts               Env loading/validation
src/db/prisma.ts            PrismaClient singleton
src/openai/                 OpenAI client + embeddings
src/services/               trips, places, itinerary, memories, gmail, messages, users, export
src/http/                   OAuth HTTP server (public /trip-planner/oauth/google/*, /health)
src/agent/                  system prompt, tools, agent loop, memory extraction
src/bot/                    Telegraf bot
src/index.ts                Entry point (bot + optional HTTP server)
scripts/                    start-local, start-server, deploy, shared lib
deploy/                     systemd unit + nginx snippets (static + oauth)
web/                        public pages for Google OAuth branding
```
