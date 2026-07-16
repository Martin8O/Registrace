-- M37 — meal prices per age category × pricing tier, and the tier for every age.
--
-- Two backfills run alongside the DDL. Both exist for the same reason: after this
-- migration the engine sources prices from the price lists, so any event left
-- without rows would silently start charging 0. The backfills give every existing
-- event an explicit price list equal to what it already charges, so no live price
-- moves and no event needs manual editing.

-- CreateTable
CREATE TABLE "MealPricingRule" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "ageCategory" "AgeCategory" NOT NULL,
    "pricingType" "PricingType" NOT NULL DEFAULT 'STANDARD',
    "price" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealPricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MealPricingRule_eventId_idx" ON "MealPricingRule"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "MealPricingRule_eventId_mealType_ageCategory_pricingType_key" ON "MealPricingRule"("eventId", "mealType", "ageCategory", "pricingType");

-- AddForeignKey
ALTER TABLE "MealPricingRule" ADD CONSTRAINT "MealPricingRule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill 1 — meal price list for every existing event.
--
-- Every age × tier gets the flat price the event charges for that meal type today,
-- so nobody's meal price changes; admins can then differentiate from that baseline.
-- MAX(price) per (event, mealType) is the event's price for that meal: verified at
-- write time that no event varies a meal type's price across its days, and MAX
-- ignores a closed slot left at 0.
INSERT INTO "MealPricingRule" ("id", "eventId", "mealType", "ageCategory", "pricingType", "price", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    m."eventId",
    m."mealType",
    a."ageCategory",
    t."pricingType",
    m."price",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT "eventId", "mealType", MAX("price") AS "price"
    FROM "EventMeal"
    GROUP BY "eventId", "mealType"
) m
CROSS JOIN (VALUES ('AGE_0_3'::"AgeCategory"), ('AGE_4_7'), ('AGE_8_14'), ('AGE_15_PLUS')) AS a("ageCategory")
CROSS JOIN (VALUES ('STANDARD'::"PricingType"), ('SUPPORTED'), ('SURPLUS')) AS t("pricingType")
ON CONFLICT ("eventId", "mealType", "ageCategory", "pricingType") DO NOTHING;

-- Backfill 2 — child participation rows for the two tiers that did not exist.
--
-- Until now the tier was a 15+-only concept, so children only ever had a STANDARD
-- row. The public form now offers all three tiers at every age, and the engine
-- prices a participant from the rule matching (age, tier) — a missing rule yields 0.
-- Cloning STANDARD into SUPPORTED/SURPLUS keeps a child's price independent of the
-- tier on these events, which is exactly how they behave today.
INSERT INTO "PricingRule" ("id", "eventId", "ageCategory", "pricingType", "dailyRate", "nightRate", "morningArrivalDiscount", "afternoonArrivalDiscount", "eveningArrivalDiscount", "earlyDepartureDiscount", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    r."eventId",
    r."ageCategory",
    t."pricingType",
    r."dailyRate",
    r."nightRate",
    r."morningArrivalDiscount",
    r."afternoonArrivalDiscount",
    r."eveningArrivalDiscount",
    r."earlyDepartureDiscount",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "PricingRule" r
CROSS JOIN (VALUES ('SUPPORTED'::"PricingType"), ('SURPLUS')) AS t("pricingType")
WHERE r."ageCategory" <> 'AGE_15_PLUS'
  AND r."pricingType" = 'STANDARD'
ON CONFLICT ("eventId", "ageCategory", "pricingType") DO NOTHING;
