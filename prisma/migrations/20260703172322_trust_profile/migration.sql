-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "creatorTimedOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAssignedCreatorId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Request_lastAssignedCreatorId_idx" ON "Request"("lastAssignedCreatorId");
