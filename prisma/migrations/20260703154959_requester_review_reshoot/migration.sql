-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "requesterRejectionReason" TEXT,
ADD COLUMN     "requesterReviewRemarks" TEXT,
ADD COLUMN     "reshootCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reshootReason" TEXT;
