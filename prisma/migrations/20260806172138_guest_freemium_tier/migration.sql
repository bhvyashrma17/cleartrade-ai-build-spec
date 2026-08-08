-- CreateEnum
CREATE TYPE "OrgTier" AS ENUM ('guest', 'free', 'paid');

-- AlterTable
ALTER TABLE "ExporterOrg" ADD COLUMN     "guest_expires_at" TIMESTAMP(3),
ADD COLUMN     "tier" "OrgTier" NOT NULL DEFAULT 'guest',
ADD COLUMN     "upgraded_at" TIMESTAMP(3);

-- Backfill: the column default is 'guest' because that is what almost every NEW row will
-- be, but every row that already exists was created under the old all-access assumption.
-- Without this, applying the migration silently paywalls every existing tenant.
-- This runs once, against exactly the rows present before this migration.
UPDATE "ExporterOrg" SET "tier" = 'paid';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GuestRunQuota" (
    "id" TEXT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "runs_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestRunQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestRunQuota_window_start_idx" ON "GuestRunQuota"("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "GuestRunQuota_ip_hash_window_start_key" ON "GuestRunQuota"("ip_hash", "window_start");

-- CreateIndex
CREATE INDEX "ExporterOrg_tier_idx" ON "ExporterOrg"("tier");

-- CreateIndex
CREATE INDEX "ExporterOrg_tier_guest_expires_at_idx" ON "ExporterOrg"("tier", "guest_expires_at");
