-- CreateEnum
CREATE TYPE "EscrowCurrency" AS ENUM ('CREDIT', 'INR');

-- AlterTable
ALTER TABLE "RequestEscrow" ADD COLUMN     "currency" "EscrowCurrency" NOT NULL DEFAULT 'INR';
