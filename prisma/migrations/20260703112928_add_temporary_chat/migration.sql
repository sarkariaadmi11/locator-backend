-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "chatFlaggedForReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessage_requestId_createdAt_idx" ON "ChatMessage"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_requestId_blocked_idx" ON "ChatMessage"("requestId", "blocked");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
