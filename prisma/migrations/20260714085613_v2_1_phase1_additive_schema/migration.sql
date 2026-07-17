-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NONE', 'BASIC', 'FULL');

-- CreateEnum
CREATE TYPE "AcceptanceMode" AS ENUM ('FIRST_ACCEPTED', 'HIGHEST_RATED');

-- CreateEnum
CREATE TYPE "RequestCurrencyMode" AS ENUM ('CREDIT', 'INR');

-- CreateEnum
CREATE TYPE "LedgerCurrency" AS ENUM ('CREDIT', 'CONNECT', 'INR');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerReasonCode" AS ENUM ('SIGNUP_BONUS', 'DAILY_CONNECT_BONUS', 'REQUEST_HOLD', 'REQUEST_REFUND', 'ACCEPT_SPEND', 'ACCEPT_REFUND', 'CREATOR_REWARD', 'TIP_SENT', 'TIP_RECEIVED', 'ADMIN_ADJUSTMENT', 'COMMISSION_DEDUCTION', 'PAYOUT', 'TOP_UP');

-- CreateEnum
CREATE TYPE "PreAcceptanceQueryStatus" AS ENUM ('OPEN', 'CLOSED_DECLINED', 'CLOSED_ACCEPTED', 'CLOSED_EXPIRED');

-- CreateEnum
CREATE TYPE "MatchingWindowReservationStatus" AS ENUM ('RESERVED', 'SPENT', 'RELEASED');

-- CreateEnum
CREATE TYPE "VerifiedCreatorRevokedReason" AS ENUM ('SUSPENSION', 'LOW_RATING', 'ADMIN_MANUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestStatus" ADD VALUE 'PENDING_MODERATION';
ALTER TYPE "RequestStatus" ADD VALUE 'MATCHING_WINDOW';
ALTER TYPE "RequestStatus" ADD VALUE 'TIPPING';

-- AlterTable
ALTER TABLE "Rating" ADD COLUMN     "visibleAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "acceptanceMode" "AcceptanceMode" NOT NULL DEFAULT 'FIRST_ACCEPTED',
ADD COLUMN     "currencyMode" "RequestCurrencyMode" NOT NULL DEFAULT 'INR',
ADD COLUMN     "settingsVersionId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankIfsc" TEXT,
ADD COLUMN     "bonusCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creatorConnects" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earnedCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kycStatus" "KycStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "lastDailyConnectGrantDate" DATE,
ADD COLUMN     "purchasedCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "usernameChangedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformSettingVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB NOT NULL,
    "changedByAdminId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSettingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "LedgerCurrency" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER,
    "reasonCode" "LedgerReasonCode" NOT NULL,
    "requestId" TEXT,
    "actorId" TEXT,
    "settingsVersionId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreAcceptanceQuery" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "exchangeCount" INTEGER NOT NULL DEFAULT 0,
    "status" "PreAcceptanceQueryStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreAcceptanceQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreAcceptanceQueryMessage" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreAcceptanceQueryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchingWindowResponse" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectReservationStatus" "MatchingWindowReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "distanceMetres" INTEGER,

    CONSTRAINT "MatchingWindowResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostSubmissionChatMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "blockedAttempt" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostSubmissionChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tip" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifiedCreatorStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "revokedReason" "VerifiedCreatorRevokedReason",
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifiedCreatorStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformSetting_updatedAt_idx" ON "PlatformSetting"("updatedAt");

-- CreateIndex
CREATE INDEX "PlatformSettingVersion_key_createdAt_idx" ON "PlatformSettingVersion"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_currency_createdAt_idx" ON "LedgerEntry"("userId", "currency", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_requestId_idx" ON "LedgerEntry"("requestId");

-- CreateIndex
CREATE INDEX "LedgerEntry_reasonCode_idx" ON "LedgerEntry"("reasonCode");

-- CreateIndex
CREATE INDEX "PreAcceptanceQuery_requestId_idx" ON "PreAcceptanceQuery"("requestId");

-- CreateIndex
CREATE INDEX "PreAcceptanceQuery_creatorId_idx" ON "PreAcceptanceQuery"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "PreAcceptanceQuery_requestId_creatorId_key" ON "PreAcceptanceQuery"("requestId", "creatorId");

-- CreateIndex
CREATE INDEX "PreAcceptanceQueryMessage_queryId_createdAt_idx" ON "PreAcceptanceQueryMessage"("queryId", "createdAt");

-- CreateIndex
CREATE INDEX "MatchingWindowResponse_requestId_idx" ON "MatchingWindowResponse"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchingWindowResponse_requestId_creatorId_key" ON "MatchingWindowResponse"("requestId", "creatorId");

-- CreateIndex
CREATE INDEX "PostSubmissionChatMessage_requestId_createdAt_idx" ON "PostSubmissionChatMessage"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tip_requestId_key" ON "Tip"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedCreatorStatus_userId_key" ON "VerifiedCreatorStatus"("userId");

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_settingsVersionId_fkey" FOREIGN KEY ("settingsVersionId") REFERENCES "PlatformSettingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAcceptanceQuery" ADD CONSTRAINT "PreAcceptanceQuery_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAcceptanceQuery" ADD CONSTRAINT "PreAcceptanceQuery_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAcceptanceQueryMessage" ADD CONSTRAINT "PreAcceptanceQueryMessage_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "PreAcceptanceQuery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchingWindowResponse" ADD CONSTRAINT "MatchingWindowResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchingWindowResponse" ADD CONSTRAINT "MatchingWindowResponse_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSubmissionChatMessage" ADD CONSTRAINT "PostSubmissionChatMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSubmissionChatMessage" ADD CONSTRAINT "PostSubmissionChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedCreatorStatus" ADD CONSTRAINT "VerifiedCreatorStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
