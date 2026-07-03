-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('IMMEDIATE', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "RequestCategory" AS ENUM ('TRAFFIC', 'EVENTS', 'FOOD_DINING', 'PUBLIC_SPACE', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationCategory" AS ENUM ('PUBLIC', 'RESTRICTED', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CREATOR_ASSIGNED', 'TEMPORARY_CHAT', 'RECORDING', 'UPLOAD', 'MODERATOR_REVIEW', 'REQUESTER_REVIEW', 'RESHOOT_REQUESTED', 'ACCEPTED', 'PAYMENT_RELEASED', 'COMPLETED', 'REJECTED', 'DISPUTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "creatorId" TEXT,
    "type" "RequestType" NOT NULL DEFAULT 'IMMEDIATE',
    "scheduledAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "formattedAddress" TEXT,
    "locationCategory" "LocationCategory" NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 500,
    "description" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "rewardAmount" DECIMAL(12,2) NOT NULL,
    "category" "RequestCategory" NOT NULL,
    "instructions" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "highValueReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "reshootUsed" BOOLEAN NOT NULL DEFAULT false,
    "requesterDeclarationAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptanceTimerExpiresAt" TIMESTAMP(3),
    "recordingStartedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "moderatorDecisionAt" TIMESTAMP(3),
    "moderatorRejectionReason" TEXT,
    "requesterDecisionAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Request_requesterId_idx" ON "Request"("requesterId");

-- CreateIndex
CREATE INDEX "Request_creatorId_idx" ON "Request"("creatorId");

-- CreateIndex
CREATE INDEX "Request_status_idx" ON "Request"("status");

-- CreateIndex
CREATE INDEX "Request_expiresAt_idx" ON "Request"("expiresAt");

-- CreateIndex
CREATE INDEX "Request_status_expiresAt_idx" ON "Request"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
