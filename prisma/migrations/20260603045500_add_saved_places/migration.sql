-- CreateTable
CREATE TABLE "saved_places" (
  "id" SERIAL NOT NULL,
  "telegram_id" BIGINT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "PlaceCategory" NOT NULL DEFAULT 'other',
  "address" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "external_provider" TEXT,
  "external_id" TEXT,
  "website_url" TEXT,
  "maps_url" TEXT,
  "phone" TEXT,
  "booking_url" TEXT,
  "ticket_url" TEXT,
  "reservation_recommended" BOOLEAN NOT NULL DEFAULT false,
  "opening_hours" JSONB,
  "rating" DOUBLE PRECISION,
  "price_level" INTEGER,
  "priority" INTEGER,
  "duration_min" INTEGER,
  "kid_friendly" BOOLEAN,
  "status" TEXT NOT NULL DEFAULT 'want_to_visit',
  "source_note" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "saved_places"
  ADD CONSTRAINT "saved_places_telegram_id_fkey"
  FOREIGN KEY ("telegram_id") REFERENCES "tg_users"("telegram_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "saved_places_telegram_id_external_provider_external_id_key"
  ON "saved_places"("telegram_id", "external_provider", "external_id");

-- CreateIndex
CREATE INDEX "saved_places_telegram_id_idx"
  ON "saved_places"("telegram_id");

-- CreateIndex
CREATE INDEX "saved_places_telegram_id_status_idx"
  ON "saved_places"("telegram_id", "status");
