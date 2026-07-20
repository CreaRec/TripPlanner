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
Telegram  <->  Bot/Agent (Docker / local Node)  <->  Postgres + pgvector (Docker)
                      |
                      +-->  OpenAI API (chat + embeddings)
                      +-->  Google Places API (optional place enrichment)
                      +-->  Gmail API via OAuth (optional per-user email search)
                      +-->  S3 bucket (optional cached exports) or ./data/exports (local fallback)
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

Deferred (not in MVP): KML export, web search, auto-booking.

## Export storage (optional S3)

When `S3_BUCKET` and `AWS_REGION` are set, generated files (itinerary PDF/CSV, Gmail PDF exports with attachments, route comparison map PNGs) are stored in S3 and reused as a cache. Itinerary exports auto-regenerate when trip/itinerary/places data changes; Gmail and route-map exports are keyed by message or route identity. Users can force a refresh via the agent (`force_refresh`) or with phrases like "обнови письмо 2".

When S3 is not configured, exports are written under `DATA_DIR` (default `./data/exports`) with no cross-request caching.

Retention (S3 only): objects older than 30 days are deleted, then if the bucket still exceeds 4 GB the oldest objects are evicted until under the cap. Tune with `EXPORT_CACHE_MAX_AGE_DAYS`, `EXPORT_BUCKET_MAX_BYTES`, and `EXPORT_RETENTION_INTERVAL_MS`.

Minimal IAM policy for the export bucket:

```json
{
  "Effect": "Allow",
  "Action": ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
  "Resource": ["arn:aws:s3:::YOUR_BUCKET", "arn:aws:s3:::YOUR_BUCKET/*"]
}
```

## Requirements

- Node.js >= 24
- Docker + Docker Compose
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An OpenAI API key
- Optional: a Google Maps Platform key (Places API (New), Routes, Static Maps, Weather as needed)
- Optional: Gmail OAuth credentials (Gmail API + OAuth Web client) for per-user email search

## Gmail integration (optional)

1. In Google Cloud: enable **Gmail API**, add scope `https://www.googleapis.com/auth/gmail.readonly` on the OAuth consent screen, create an OAuth **Web** client with redirect URI `https://<your-domain>/trip-planner/oauth/google/callback`.
2. Set in `.env`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `PUBLIC_APP_URL`, `OAUTH_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`), `HTTP_PORT` (default `3000`).
3. In your HTTPS nginx `server { }` block include both snippets (install manually from [`deploy/nginx/`](deploy/nginx/) under `/etc/nginx/snippets/`):

   ```nginx
   include /etc/nginx/snippets/crea-trip-planner-static.conf;
   include /etc/nginx/snippets/crea-trip-planner-oauth.conf;
   ```

4. Apply the Prisma migration that adds `gmail_accounts` and `oauth_states`.
5. In Telegram: say "connect gmail" or "подключить почту" → open the link → allow access. Repeat to add more inboxes. Ask "which inboxes are connected?" to list linked mailboxes.

While the OAuth app is in **Testing**, add each Google account email under **Test users** in Google Cloud.

Email export renders the message HTML to PDF via Chromium and also sends separate file attachments to Telegram (inline images stay in the PDF only). Attachments larger than 10 MB are skipped with a notice to open them in Gmail. Production Docker image includes Chromium (`CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`). For local native runs, install `chromium` (Debian: `sudo apt install chromium`) if needed. Remote images in the email body require outbound network during render.

Smoke test (host Chromium or inside the bot container):

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
| `scripts/start-local.sh` | Local dev: bring up Docker Postgres only, generate client, migrate, run the bot with reload. |

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
recreation never wipe the database. **Never** run `docker compose down -v` or change the volume path
on the server. When S3 is configured, generated exports are stored in the bucket; otherwise they
are written under `./data/exports` (also used as a temp staging area). The whole `data/` directory
is gitignored.

## Deployment

Production is Docker Compose (`db` + `bot`) with the bot image from GHCR. Releases are **only** via
GitHub Actions on merge/push to `main` — there is no local deploy script.

See [`docs/docker.md`](docs/docker.md) for GHCR bootstrap, server checklist (existing `crea-trip-planner-db`), and day-to-day ops.

### GitHub Actions CI/CD

**On every push and pull request:** `test` runs `npm ci`, `npm run generate`, `npm test`, and a Docker image build (no push).

**On push to `main` only:** `publish` pushes `ghcr.io/crearec/crea-trip-planner:main` and `:sha-<short>`, then `deploy` joins Tailscale (`tag:ci`), copies `docker-compose.yml` over SSH, exports `IMAGE_TAG` for Compose, and runs `docker compose pull && up -d`.

Required GitHub Secrets:

| Secret | Purpose |
|--------|---------|
| `DEPLOY_SSH_KEY` | Private deploy key (matching the public key in server `authorized_keys`) |
| `DEPLOY_HOST` | Tailscale IP or MagicDNS hostname (for example `100.118.169.52`) |
| `DEPLOY_USER` | SSH user, for example `crearec` |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID (Trust credentials) for ephemeral CI nodes |
| `TS_OAUTH_SECRET` | Tailscale OAuth client secret (Trust credentials) |

Server needs Docker Compose for the deploy user and a private GHCR login. Existing `.env` and `data/postgres` are reused; CI never mutates `.env`.

## Project layout

```
docker-compose.yml          Postgres + bot (GHCR image)
Dockerfile                  Multi-stage Node 24 bot image
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
scripts/                    start-local + shared lib
deploy/nginx/               nginx snippets (static + oauth; install manually)
docs/docker.md              Production Docker + GHCR guide
web/                        public pages for Google OAuth branding
```
