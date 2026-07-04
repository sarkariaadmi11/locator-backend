-- CreateEnum
CREATE TYPE "EscrowState" AS ENUM ('RESERVED', 'RELEASED', 'REFUNDED', 'FROZEN', 'SPLIT');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "requestId" TEXT;

-- CreateTable
CREATE TABLE "RequestEscrow" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "amountLocked" DECIMAL(12,2) NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "creatorEarnings" DECIMAL(12,2) NOT NULL,
    "refundAmount" DECIMAL(12,2),
    "state" "EscrowState" NOT NULL DEFAULT 'RESERVED',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestEscrow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestEscrow_requestId_key" ON "RequestEscrow"("requestId");

-- CreateIndex
CREATE INDEX "RequestEscrow_state_idx" ON "RequestEscrow"("state");

-- CreateIndex
CREATE INDEX "Transaction_requestId_idx" ON "Transaction"("requestId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestEscrow" ADD CONSTRAINT "RequestEscrow_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
