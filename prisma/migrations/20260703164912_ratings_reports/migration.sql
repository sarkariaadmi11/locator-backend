-- CreateEnum
CREATE TYPE "RatingRole" AS ENUM ('REQUESTER_RATES_CREATOR', 'CREATOR_RATES_REQUESTER');

-- CreateEnum
CREATE TYPE "ReportCategory" AS ENUM ('PRIVACY_ISSUE', 'WRONG_LOCATION', 'ABUSE', 'FAKE_RECORDING', 'COPYRIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "rateeId" TEXT NOT NULL,
    "role" "RatingRole" NOT NULL,
    "stars" INTEGER NOT NULL,
    "reviewText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "category" "ReportCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT[],
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "resolvedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rating_rateeId_idx" ON "Rating"("rateeId");

-- CreateIndex
CREATE INDEX "Rating_requestId_idx" ON "Rating"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_requestId_raterId_key" ON "Rating"("requestId", "raterId");

-- CreateIndex
CREATE INDEX "Report_reportedUserId_idx" ON "Report"("reportedUserId");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_reportedUserId_createdAt_idx" ON "Report"("reportedUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterId_reportedUserId_requestId_key" ON "Report"("reporterId", "reportedUserId", "requestId");

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_rateeId_fkey" FOREIGN KEY ("rateeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
