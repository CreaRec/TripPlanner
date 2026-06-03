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
                      +-->  ./data/exports (PDF / CSV)
```

## Features (MVP)

- Trips: create, list, select an active trip.
- Chat: free-text conversation with a tool-calling planning agent.
- Memory: structured, embedded memories (preferences, constraints, decisions) retrieved via semantic search.
- Places: save points of interest with category, notes, kid-friendly flag, and optional Google Places enrichment.
- Itinerary: day-by-day plans with ordered items.
- Export: generate PDF and CSV of an itinerary, delivered as Telegram documents.

Deferred (not in MVP): external maps/geocoding/routing APIs, KML export, web search, auto-booking, Redis cache/jobs.

## Requirements

- Node.js >= 20
- Docker + Docker Compose
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An OpenAI API key
- Optional: a Google Maps Platform key with Places API (New) enabled

## Setup

1. Copy the env template and fill it in:

   ```bash
   cp .env.example .env
   # edit .env: TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, ALLOWED_TELEGRAM_IDS
   ```

   Find your numeric Telegram ID via [@userinfobot](https://t.me/userinfobot) and put it in
   `ALLOWED_TELEGRAM_IDS` (comma-separated for multiple people).

   To enrich saved places with addresses, coordinates, maps links, websites, hours/ratings, and
   booking or ticket advice, set `GOOGLE_MAPS_API_KEY`. In Google Cloud, restrict the key to
   Places API (New), use minimal field masks, and set a small budget alert.

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
| `scripts/deploy.sh` | Sync the project to the Debian server, build (incl. `prisma generate`), migrate, install/restart the `telegram-trip-planner` systemd service. |

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

Make sure `.env` exists in `REMOTE_APP_DIR` on the server (the deploy script never overwrites it).

## Project layout

```
docker-compose.yml          Postgres + pgvector service
prisma/schema.prisma        Schema (source of truth) + vector extension
prisma/migrations/          Committed Prisma migrations
src/config.ts               Env loading/validation
src/db/prisma.ts            PrismaClient singleton
src/openai/                 OpenAI client + embeddings
src/services/               trips, places, itinerary, memories, messages, users, export
src/agent/                  system prompt, tools, agent loop, memory extraction
src/bot/                    Telegraf bot
src/index.ts                Entry point
scripts/                    start-local, start-server, deploy, shared lib
deploy/                     systemd unit template
```
