-- CreateEnum
CREATE TYPE "RestrictedLocationCategory" AS ENUM ('RESTRICTED', 'PROHIBITED');

-- CreateTable
CREATE TABLE "RestrictedLocation" (
    "id" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "category" "RestrictedLocationCategory" NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestrictedLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestrictedLocation_category_idx" ON "RestrictedLocation"("category");
