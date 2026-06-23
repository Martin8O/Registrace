-- AlterEnum
ALTER TYPE "RegistrationStatus" ADD VALUE 'PAID';

-- AlterTable: Event gets the frozen number prefix + atomic per-event registrant counter
ALTER TABLE "Event" ADD COLUMN     "numberPrefix" TEXT,
ADD COLUMN     "registrationSeq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Registration gets the human-readable unique number
ALTER TABLE "Registration" ADD COLUMN     "registrationNumber" TEXT;

-- CreateIndex (unique; multiple NULLs allowed in Postgres until backfilled)
CREATE UNIQUE INDEX "Event_numberPrefix_key" ON "Event"("numberPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_registrationNumber_key" ON "Registration"("registrationNumber");
