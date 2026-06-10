-- AlterEnum
BEGIN;
CREATE TYPE "RegistrationStatus_new" AS ENUM ('REGISTERED', 'CANCELLED');
ALTER TABLE "public"."Registration" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Registration" ALTER COLUMN "status" TYPE "RegistrationStatus_new" USING ("status"::text::"RegistrationStatus_new");
ALTER TYPE "RegistrationStatus" RENAME TO "RegistrationStatus_old";
ALTER TYPE "RegistrationStatus_new" RENAME TO "RegistrationStatus";
DROP TYPE "public"."RegistrationStatus_old";
ALTER TABLE "Registration" ALTER COLUMN "status" SET DEFAULT 'REGISTERED';
COMMIT;

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "centerId" TEXT NOT NULL,
ADD COLUMN     "createdBy" UUID,
ADD COLUMN     "description_cs" TEXT,
ADD COLUMN     "description_en" TEXT;

-- AlterTable
ALTER TABLE "Registration" ALTER COLUMN "status" SET DEFAULT 'REGISTERED';

-- CreateTable
CREATE TABLE "UserCenter" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "centerId" TEXT NOT NULL,

    CONSTRAINT "UserCenter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserCenter_userId_idx" ON "UserCenter"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCenter_userId_centerId_key" ON "UserCenter"("userId", "centerId");

-- CreateIndex
CREATE INDEX "Event_createdBy_idx" ON "Event"("createdBy");

-- CreateIndex
CREATE INDEX "Event_centerId_idx" ON "Event"("centerId");

-- AddForeignKey
ALTER TABLE "UserCenter" ADD CONSTRAINT "UserCenter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCenter" ADD CONSTRAINT "UserCenter_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
