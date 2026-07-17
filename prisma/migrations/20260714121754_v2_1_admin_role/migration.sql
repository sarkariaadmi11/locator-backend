-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('MODERATOR', 'ADMIN');

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "role" "AdminRole" NOT NULL DEFAULT 'ADMIN';
