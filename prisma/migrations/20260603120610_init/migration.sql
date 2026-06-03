-- CreateEnum
CREATE TYPE "AgeCategory" AS ENUM ('AGE_0_3', 'AGE_4_7', 'AGE_8_14', 'AGE_15_PLUS');

-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('STANDARD', 'SUPPORTED', 'SURPLUS');

-- CreateEnum
CREATE TYPE "ArrivalTime" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "EarlyDeparture" AS ENUM ('NONE', 'AFTER_BREAKFAST');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'WAITLIST');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Center" (
    "id" TEXT NOT NULL,
    "name_cs" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Center_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title_cs" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "subtitle_cs" TEXT,
    "subtitle_en" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "maxRegistrations" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDate" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label_cs" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ageCategory" "AgeCategory" NOT NULL,
    "pricingType" "PricingType" NOT NULL DEFAULT 'STANDARD',
    "dailyRate" INTEGER NOT NULL DEFAULT 0,
    "nightRate" INTEGER NOT NULL DEFAULT 0,
    "morningArrivalDiscount" INTEGER NOT NULL DEFAULT 0,
    "afternoonArrivalDiscount" INTEGER NOT NULL DEFAULT 0,
    "eveningArrivalDiscount" INTEGER NOT NULL DEFAULT 0,
    "earlyDepartureDiscount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMeal" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventDateId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "label_cs" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,

    CONSTRAINT "EventMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "arrivalDateId" TEXT NOT NULL,
    "arrivalTime" "ArrivalTime" NOT NULL,
    "departureDateId" TEXT NOT NULL,
    "earlyDeparture" "EarlyDeparture" NOT NULL DEFAULT 'NONE',
    "hasAccommodation" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT NOT NULL,
    "gdprConsent" BOOLEAN NOT NULL DEFAULT false,
    "totalPrice" INTEGER NOT NULL DEFAULT 0,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "confirmationSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "ipAddress" TEXT,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "ageCategory" "AgeCategory" NOT NULL,
    "pricingType" "PricingType" NOT NULL DEFAULT 'STANDARD',
    "participationPrice" INTEGER NOT NULL DEFAULT 0,
    "mealPrice" INTEGER NOT NULL DEFAULT 0,
    "totalPrice" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipantMeal" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "eventMealId" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ParticipantMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- CreateIndex
CREATE INDEX "Event_startDate_idx" ON "Event"("startDate");

-- CreateIndex
CREATE INDEX "EventDate_eventId_idx" ON "EventDate"("eventId");

-- CreateIndex
CREATE INDEX "PricingRule_eventId_idx" ON "PricingRule"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_eventId_ageCategory_pricingType_key" ON "PricingRule"("eventId", "ageCategory", "pricingType");

-- CreateIndex
CREATE INDEX "EventMeal_eventId_idx" ON "EventMeal"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventMeal_eventDateId_mealType_key" ON "EventMeal"("eventDateId", "mealType");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_idempotencyKey_key" ON "Registration"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Registration_eventId_idx" ON "Registration"("eventId");

-- CreateIndex
CREATE INDEX "Registration_email_idx" ON "Registration"("email");

-- CreateIndex
CREATE INDEX "Registration_createdAt_idx" ON "Registration"("createdAt");

-- CreateIndex
CREATE INDEX "Participant_registrationId_idx" ON "Participant"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipantMeal_participantId_eventMealId_key" ON "ParticipantMeal"("participantId", "eventMealId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "EventDate" ADD CONSTRAINT "EventDate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMeal" ADD CONSTRAINT "EventMeal_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMeal" ADD CONSTRAINT "EventMeal_eventDateId_fkey" FOREIGN KEY ("eventDateId") REFERENCES "EventDate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_arrivalDateId_fkey" FOREIGN KEY ("arrivalDateId") REFERENCES "EventDate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_departureDateId_fkey" FOREIGN KEY ("departureDateId") REFERENCES "EventDate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantMeal" ADD CONSTRAINT "ParticipantMeal_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantMeal" ADD CONSTRAINT "ParticipantMeal_eventMealId_fkey" FOREIGN KEY ("eventMealId") REFERENCES "EventMeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
