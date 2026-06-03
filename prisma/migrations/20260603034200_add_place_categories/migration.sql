-- CreateEnum
CREATE TYPE "PlaceCategory" AS ENUM (
  'restaurant',
  'museum',
  'natural_attraction',
  'national_park',
  'tour',
  'other'
);

-- AlterTable
ALTER TABLE "places"
  ALTER COLUMN "category" TYPE "PlaceCategory"
  USING (
    CASE
      WHEN "category" IS NULL THEN 'other'::"PlaceCategory"
      WHEN "category" IN (
        'restaurant',
        'museum',
        'natural_attraction',
        'national_park',
        'tour',
        'other'
      ) THEN "category"::"PlaceCategory"
      ELSE 'other'::"PlaceCategory"
    END
  ),
  ALTER COLUMN "category" SET DEFAULT 'other',
  ALTER COLUMN "category" SET NOT NULL;
