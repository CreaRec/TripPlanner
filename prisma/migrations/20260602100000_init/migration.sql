-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "tg_users" (
    "telegram_id" BIGINT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_users_pkey" PRIMARY KEY ("telegram_id")
);

-- CreateTable
CREATE TABLE "app_state" (
    "telegram_id" BIGINT NOT NULL,
    "active_trip_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_state_pkey" PRIMARY KEY ("telegram_id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "destination" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "travelers" TEXT,
    "summary" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" SERIAL NOT NULL,
    "trip_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "priority" INTEGER,
    "duration_min" INTEGER,
    "kid_friendly" BOOLEAN,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_days" (
    "id" SERIAL NOT NULL,
    "trip_id" INTEGER NOT NULL,
    "day_number" INTEGER NOT NULL,
    "date" DATE,
    "title" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itinerary_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itinerary_items" (
    "id" SERIAL NOT NULL,
    "day_id" INTEGER NOT NULL,
    "place_id" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "time_block" TEXT,
    "notes" TEXT,
    "is_backup" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itinerary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "trip_id" INTEGER,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "trip_id" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" SERIAL NOT NULL,
    "trip_id" INTEGER NOT NULL,
    "label" TEXT,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_telegram_id_idx" ON "trips"("telegram_id");

-- CreateIndex
CREATE INDEX "places_trip_id_idx" ON "places"("trip_id");

-- CreateIndex
CREATE INDEX "itinerary_days_trip_id_idx" ON "itinerary_days"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_days_trip_id_day_number_key" ON "itinerary_days"("trip_id", "day_number");

-- CreateIndex
CREATE INDEX "itinerary_items_day_id_idx" ON "itinerary_items"("day_id");

-- CreateIndex
CREATE INDEX "conversation_messages_telegram_id_created_at_idx" ON "conversation_messages"("telegram_id", "created_at");

-- CreateIndex
CREATE INDEX "memories_telegram_id_idx" ON "memories"("telegram_id");

-- CreateIndex
CREATE INDEX "plan_versions_trip_id_idx" ON "plan_versions"("trip_id");

-- AddForeignKey
ALTER TABLE "app_state" ADD CONSTRAINT "app_state_telegram_id_fkey" FOREIGN KEY ("telegram_id") REFERENCES "tg_users"("telegram_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_state" ADD CONSTRAINT "app_state_active_trip_id_fkey" FOREIGN KEY ("active_trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_telegram_id_fkey" FOREIGN KEY ("telegram_id") REFERENCES "tg_users"("telegram_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_days" ADD CONSTRAINT "itinerary_days_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_day_id_fkey" FOREIGN KEY ("day_id") REFERENCES "itinerary_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_telegram_id_fkey" FOREIGN KEY ("telegram_id") REFERENCES "tg_users"("telegram_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_telegram_id_fkey" FOREIGN KEY ("telegram_id") REFERENCES "tg_users"("telegram_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (manual: ivfflat for semantic memory search; not Prisma-managed)
CREATE INDEX IF NOT EXISTS "idx_memories_embedding"
    ON "memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

