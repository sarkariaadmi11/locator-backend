-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "ratingReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "recordingReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "reviewReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastNotifiedTrustBadges" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastNotifiedTrustScore" INTEGER,
ADD COLUMN     "notifyPaymentWallet" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPlatformAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyRequestActivity" BOOLEAN NOT NULL DEFAULT true;
