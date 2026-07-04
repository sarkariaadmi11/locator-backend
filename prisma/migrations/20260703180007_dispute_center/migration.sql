-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('VIDEO_QUALITY_ISSUE', 'LOCATION_MISMATCH', 'LATE_DELIVERY', 'PAYMENT_ISSUE', 'INAPPROPRIATE_CONTENT', 'NO_SHOW', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "DisputeResolution" AS ENUM ('REQUESTER_FAVOUR', 'CREATOR_FAVOUR', 'PARTIAL');

-- CreateEnum
CREATE TYPE "DisputeParticipantType" AS ENUM ('REQUESTER', 'CREATOR', 'ADMIN');

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "raisedByRole" "DisputeParticipantType" NOT NULL,
    "reason" "DisputeReason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "amountLocked" DECIMAL(12,2) NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "escrowStateAtCreation" "EscrowState" NOT NULL,
    "alreadyReleasedToCreator" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "alreadyRefundedToRequester" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "resolution" "DisputeResolution",
    "splitPercentage" DECIMAL(5,2),
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminId" TEXT,
    "caseOwnerAdminId" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeMessage" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorType" "DisputeParticipantType" NOT NULL,
    "authorUserId" TEXT,
    "authorAdminId" TEXT,
    "body" TEXT NOT NULL,
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "uploadedByType" "DisputeParticipantType" NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByAdminId" TEXT,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_requestId_key" ON "Dispute"("requestId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_raisedById_idx" ON "Dispute"("raisedById");

-- CreateIndex
CREATE INDEX "Dispute_caseOwnerAdminId_idx" ON "Dispute"("caseOwnerAdminId");

-- CreateIndex
CREATE INDEX "Dispute_createdAt_idx" ON "Dispute"("createdAt");

-- CreateIndex
CREATE INDEX "DisputeMessage_disputeId_createdAt_idx" ON "DisputeMessage"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeEvidence_disputeId_idx" ON "DisputeEvidence"("disputeId");

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_caseOwnerAdminId_fkey" FOREIGN KEY ("caseOwnerAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_authorAdminId_fkey" FOREIGN KEY ("authorAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
