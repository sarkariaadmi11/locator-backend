-- CreateEnum
CREATE TYPE "CreatorAvailability" AS ENUM ('ONLINE', 'OFFLINE', 'BUSY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "availabilityStatus" "CreatorAvailability" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Request_status_latitude_longitude_idx" ON "Request"("status", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "User_availabilityStatus_idx" ON "User"("availabilityStatus");
