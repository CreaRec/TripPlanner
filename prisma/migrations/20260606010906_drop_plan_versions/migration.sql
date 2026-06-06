/*
  Warnings:

  - You are about to drop the `plan_versions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "plan_versions" DROP CONSTRAINT "plan_versions_trip_id_fkey";

-- DropTable
DROP TABLE "plan_versions";
