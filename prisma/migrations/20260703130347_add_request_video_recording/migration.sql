-- CreateEnum
CREATE TYPE "VideoUploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'UPLOADED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "creatorDeclarationAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RequestVideo" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "status" "VideoUploadStatus" NOT NULL DEFAULT 'PENDING',
    "storageProvider" TEXT NOT NULL DEFAULT 'cloudinary',
    "storagePublicId" TEXT,
    "secureUrl" TEXT,
    "thumbnailUrl" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fileSizeBytes" INTEGER,
    "mimeType" TEXT,
    "gpsLatitude" DOUBLE PRECISION,
    "gpsLongitude" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3),
    "uploadAttempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestVideo_requestId_idx" ON "RequestVideo"("requestId");

-- CreateIndex
CREATE INDEX "RequestVideo_requestId_status_idx" ON "RequestVideo"("requestId", "status");

-- CreateIndex
CREATE INDEX "RequestVideo_creatorId_idx" ON "RequestVideo"("creatorId");

-- AddForeignKey
ALTER TABLE "RequestVideo" ADD CONSTRAINT "RequestVideo_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVideo" ADD CONSTRAINT "RequestVideo_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
