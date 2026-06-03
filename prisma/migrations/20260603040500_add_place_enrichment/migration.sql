-- AlterTable
ALTER TABLE "places"
  ADD COLUMN "external_provider" TEXT,
  ADD COLUMN "external_id" TEXT,
  ADD COLUMN "website_url" TEXT,
  ADD COLUMN "maps_url" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "booking_url" TEXT,
  ADD COLUMN "ticket_url" TEXT,
  ADD COLUMN "reservation_recommended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "opening_hours" JSONB,
  ADD COLUMN "rating" DOUBLE PRECISION,
  ADD COLUMN "price_level" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "places_trip_id_external_provider_external_id_key"
  ON "places"("trip_id", "external_provider", "external_id");
