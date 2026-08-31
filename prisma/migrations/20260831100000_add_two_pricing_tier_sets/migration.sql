-- M40a — two INDEPENDENT pricing tier sets per event, and two independent tier
-- choices per participant (participation/accommodation vs. meals).
--
-- Additive only: nothing is dropped, renamed or moved. The two event columns
-- default to all three tiers, so every existing event keeps offering exactly what
-- it offered before, and the participant column is backfilled (see below) rather
-- than being allowed to take its own default.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "mealPricingTypes" "PricingType"[] DEFAULT ARRAY['STANDARD', 'SUPPORTED', 'SURPLUS']::"PricingType"[],
ADD COLUMN     "participationPricingTypes" "PricingType"[] DEFAULT ARRAY['STANDARD', 'SUPPORTED', 'SURPLUS']::"PricingType"[];

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "mealPricingType" "PricingType" NOT NULL DEFAULT 'STANDARD';

-- Backfill — the one statement in this migration that would otherwise rewrite history.
--
-- Until now a participant carried ONE tier that priced their stay AND their meals.
-- Leaving the new column on its STANDARD default would therefore retroactively
-- change what every supported/surplus participant ordered: their meals would look
-- as though they had been booked at the standard price. Copying the existing tier
-- reproduces exactly what each of them was charged, so no stored price moves and
-- no registration needs manual repair.
UPDATE "Participant" SET "mealPricingType" = "pricingType";
