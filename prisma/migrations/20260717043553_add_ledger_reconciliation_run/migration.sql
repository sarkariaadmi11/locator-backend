-- CreateTable
CREATE TABLE "LedgerReconciliationRun" (
    "id" TEXT NOT NULL,
    "checkedCount" INTEGER NOT NULL,
    "varianceCount" INTEGER NOT NULL,
    "variances" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerReconciliationRun_createdAt_idx" ON "LedgerReconciliationRun"("createdAt");
