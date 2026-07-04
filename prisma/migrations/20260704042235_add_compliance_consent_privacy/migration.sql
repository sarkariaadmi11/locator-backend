-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'COMMUNITY_GUIDELINES', 'RECORDING_POLICY', 'REQUESTER_DECLARATION', 'CREATOR_DECLARATION');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DeletionLogAction" AS ENUM ('ACCOUNT_DELETION_REQUESTED', 'ACCOUNT_DELETION_CANCELLED', 'ACCOUNT_HARD_DELETED', 'CHAT_MESSAGES_PURGED', 'VIDEO_ASSET_PURGED', 'NOTIFICATIONS_PURGED', 'INACTIVE_ACCOUNT_CLEANED', 'EXPIRED_DRAFT_CLEANED');

-- AlterTable
ALTER TABLE "RequestVideo" ADD COLUMN     "assetPurgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "consecutiveRejections" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionScheduledFor" TIMESTAMP(3),
ADD COLUMN     "welcomeVideoRepromptPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "DataExportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataDeletionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "DeletionLogAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataDeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_type_idx" ON "ConsentRecord"("userId", "type");

-- CreateIndex
CREATE INDEX "ConsentRecord_requestId_idx" ON "ConsentRecord"("requestId");

-- CreateIndex
CREATE INDEX "ConsentRecord_acceptedAt_idx" ON "ConsentRecord"("acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceConfig_key_key" ON "ComplianceConfig"("key");

-- CreateIndex
CREATE INDEX "DataExportRequest_userId_idx" ON "DataExportRequest"("userId");

-- CreateIndex
CREATE INDEX "DataExportRequest_status_idx" ON "DataExportRequest"("status");

-- CreateIndex
CREATE INDEX "DataDeletionLog_userId_idx" ON "DataDeletionLog"("userId");

-- CreateIndex
CREATE INDEX "DataDeletionLog_action_idx" ON "DataDeletionLog"("action");

-- CreateIndex
CREATE INDEX "DataDeletionLog_createdAt_idx" ON "DataDeletionLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
