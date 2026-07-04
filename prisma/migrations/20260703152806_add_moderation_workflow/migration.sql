-- CreateEnum
CREATE TYPE "VideoModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VideoRejectionReason" AS ENUM ('CONTENT_VIOLATION', 'PROHIBITED_LOCATION', 'GPS_MISMATCH', 'DURATION_MISMATCH', 'FAKE_RECORDING', 'OTHER');

-- AlterTable
ALTER TABLE "RequestVideo" ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderatedByAdminId" TEXT,
ADD COLUMN     "moderationRejectionReason" "VideoRejectionReason",
ADD COLUMN     "moderationRemarks" TEXT,
ADD COLUMN     "moderationStatus" "VideoModerationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorId_idx" ON "AdminAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetEntityType_targetEntityId_idx" ON "AdminAuditLog"("targetEntityType", "targetEntityId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestVideo_status_moderationStatus_idx" ON "RequestVideo"("status", "moderationStatus");

-- CreateIndex
CREATE INDEX "RequestVideo_moderatedByAdminId_idx" ON "RequestVideo"("moderatedByAdminId");

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVideo" ADD CONSTRAINT "RequestVideo_moderatedByAdminId_fkey" FOREIGN KEY ("moderatedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
