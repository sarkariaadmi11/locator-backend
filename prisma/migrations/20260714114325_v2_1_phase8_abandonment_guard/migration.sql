-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acceptanceBlockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AbandonmentEvent" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbandonmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbandonmentEvent_creatorId_createdAt_idx" ON "AbandonmentEvent"("creatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "AbandonmentEvent" ADD CONSTRAINT "AbandonmentEvent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
