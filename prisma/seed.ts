import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const prisma = new PrismaClient({ adapter });

const centers = [
  { name_cs: "Brno", name_en: "Brno", sortOrder: 10 },
  { name_cs: "Český Těšín", name_en: "Český Těšín", sortOrder: 20 },
  { name_cs: "Jihlava", name_en: "Jihlava", sortOrder: 30 },
  { name_cs: "Jilemnice", name_en: "Jilemnice", sortOrder: 40 },
  { name_cs: "Karlovy Vary", name_en: "Karlovy Vary", sortOrder: 50 },
  { name_cs: "Kladno", name_en: "Kladno", sortOrder: 60 },
  { name_cs: "Klatovy", name_en: "Klatovy", sortOrder: 70 },
  { name_cs: "Kolín", name_en: "Kolín", sortOrder: 80 },
  { name_cs: "Liberec", name_en: "Liberec", sortOrder: 90 },
  { name_cs: "Olomouc", name_en: "Olomouc", sortOrder: 100 },
  { name_cs: "Ostrava", name_en: "Ostrava", sortOrder: 110 },
  { name_cs: "Pardubice", name_en: "Pardubice", sortOrder: 120 },
  { name_cs: "Písek", name_en: "Písek", sortOrder: 130 },
  { name_cs: "Plzeň", name_en: "Plzeň", sortOrder: 140 },
  { name_cs: "Praha", name_en: "Prague", sortOrder: 150 },
  { name_cs: "Rožnov pod Radhoštěm", name_en: "Rožnov pod Radhoštěm", sortOrder: 160 },
  { name_cs: "Šumperk", name_en: "Šumperk", sortOrder: 170 },
  { name_cs: "Těnovice", name_en: "Těnovice", sortOrder: 180 },
  { name_cs: "Troják", name_en: "Troják", sortOrder: 190 },
  { name_cs: "Trutnov", name_en: "Trutnov", sortOrder: 200 },
  { name_cs: "Ústí nad Labem", name_en: "Ústí nad Labem", sortOrder: 210 },
  { name_cs: "Vyhlídky / České Budějovice", name_en: "Vyhlídky / České Budějovice", sortOrder: 220 },
  { name_cs: "Zlín", name_en: "Zlín", sortOrder: 230 },
  { name_cs: "Jiné", name_en: "Other", sortOrder: 240 },
  { name_cs: "Mimo ČR", name_en: "Not from Czechia", sortOrder: 250 },
];

// --- Sample event (B7a) -----------------------------------------------------
// One idempotent PUBLISHED event so the live public reads (B7b) and the
// registration submit (B7d) have something to read. Hosted by Těnovice,
// 4–6 Sep 2026 (Fri/Sat/Sun) — future-dated so it stays publicly visible.
// Mirrors the mock scaffolding in lib/mock/registrationOptions.ts.
const SAMPLE_EVENT_TITLE_CS = "Meditační víkend v Těnovicích";

// Days are stored as UTC midnight (invariant 11: UTC in DB, Prague in UI).
const sampleDays = [
  { date: new Date("2026-09-04T00:00:00.000Z"), label_cs: "Pátek 4. 9.", label_en: "Friday 4 Sep", sortOrder: 1 },
  { date: new Date("2026-09-05T00:00:00.000Z"), label_cs: "Sobota 5. 9.", label_en: "Saturday 5 Sep", sortOrder: 2 },
  { date: new Date("2026-09-06T00:00:00.000Z"), label_cs: "Neděle 6. 9.", label_en: "Sunday 6 Sep", sortOrder: 3 },
];

// Catalog meal prices in whole CZK (invariant 10), matching the PricingModal.
const sampleMeals = [
  { mealType: "BREAKFAST" as const, price: 80, label_cs: "snídaně", label_en: "breakfast" },
  { mealType: "LUNCH" as const, price: 120, label_cs: "oběd", label_en: "lunch" },
  { mealType: "DINNER" as const, price: 120, label_cs: "večeře", label_en: "dinner" },
];

// PricingType applies only to AGE_15_PLUS; ages 0–14 are always dailyRate 0
// (invariant 15). *Discount fields are subtracted from the total downstream.
const samplePricingRules = [
  { ageCategory: "AGE_0_3" as const, pricingType: "STANDARD" as const, dailyRate: 0, nightRate: 0, morningArrivalDiscount: 0, afternoonArrivalDiscount: 0, eveningArrivalDiscount: 0, earlyDepartureDiscount: 0 },
  { ageCategory: "AGE_4_7" as const, pricingType: "STANDARD" as const, dailyRate: 0, nightRate: 0, morningArrivalDiscount: 0, afternoonArrivalDiscount: 0, eveningArrivalDiscount: 0, earlyDepartureDiscount: 0 },
  { ageCategory: "AGE_8_14" as const, pricingType: "STANDARD" as const, dailyRate: 0, nightRate: 0, morningArrivalDiscount: 0, afternoonArrivalDiscount: 0, eveningArrivalDiscount: 0, earlyDepartureDiscount: 0 },
  { ageCategory: "AGE_15_PLUS" as const, pricingType: "STANDARD" as const, dailyRate: 200, nightRate: 150, morningArrivalDiscount: 50, afternoonArrivalDiscount: 30, eveningArrivalDiscount: 80, earlyDepartureDiscount: 50 },
  { ageCategory: "AGE_15_PLUS" as const, pricingType: "SUPPORTED" as const, dailyRate: 100, nightRate: 100, morningArrivalDiscount: 30, afternoonArrivalDiscount: 20, eveningArrivalDiscount: 50, earlyDepartureDiscount: 30 },
  { ageCategory: "AGE_15_PLUS" as const, pricingType: "SURPLUS" as const, dailyRate: 300, nightRate: 200, morningArrivalDiscount: 50, afternoonArrivalDiscount: 30, eveningArrivalDiscount: 80, earlyDepartureDiscount: 50 },
];

async function seedSampleEvent() {
  const existing = await prisma.event.findFirst({
    where: { title_cs: SAMPLE_EVENT_TITLE_CS },
  });
  if (existing) {
    console.log("Sample event already exists — skipped.");
    return;
  }

  const tenovice = await prisma.center.findFirst({
    where: { name_cs: "Těnovice" },
  });
  if (!tenovice) {
    throw new Error("Cannot seed sample event: Těnovice centre not found.");
  }

  // Event + its pricing rules in one create (pricing rules only need eventId).
  const event = await prisma.event.create({
    data: {
      title_cs: SAMPLE_EVENT_TITLE_CS,
      title_en: "Meditation Weekend in Těnovice",
      subtitle_cs: "Otevřený pro všechny",
      subtitle_en: "Open to everyone",
      description_cs:
        "Víkendový pobytový retreat zaměřený na meditaci na Buddhu Diamantové cesty. Vhodný pro začátečníky i zkušené praktikující.",
      description_en:
        "A weekend residential retreat focused on Diamond Way Buddhist meditation. Suitable for both newcomers and experienced practitioners.",
      contactName: "BDC Těnovice",
      contactPhone: "+420 377 123 456",
      contactEmail: "tenovice@bdc.cz",
      status: "PUBLISHED",
      createdBy: null,
      centerId: tenovice.id,
      startDate: new Date("2026-09-04T00:00:00.000Z"),
      endDate: new Date("2026-09-06T00:00:00.000Z"),
      pricingRules: { create: samplePricingRules },
    },
  });

  // Dates + per-day meals (EventMeal needs both eventId and eventDateId).
  for (const day of sampleDays) {
    const eventDate = await prisma.eventDate.create({
      data: {
        eventId: event.id,
        date: day.date,
        label_cs: day.label_cs,
        label_en: day.label_en,
        sortOrder: day.sortOrder,
      },
    });
    for (const meal of sampleMeals) {
      await prisma.eventMeal.create({
        data: {
          eventId: event.id,
          eventDateId: eventDate.id,
          mealType: meal.mealType,
          price: meal.price,
          isClosed: false,
          label_cs: `${day.label_cs} – ${meal.label_cs}`,
          label_en: `${day.label_en} – ${meal.label_en}`,
        },
      });
    }
  }

  console.log(
    `Created sample event "${event.title_cs}" (${event.id}): ${sampleDays.length} dates, ` +
      `${sampleDays.length * sampleMeals.length} meals, ${samplePricingRules.length} pricing rules.`,
  );
}

async function main() {
  console.log("Seeding centers...");
  let created = 0;

  for (const center of centers) {
    const existing = await prisma.center.findFirst({
      where: { name_cs: center.name_cs },
    });
    if (!existing) {
      await prisma.center.create({
        data: { ...center, isActive: true },
      });
      created++;
    }
  }

  console.log(`Done. Created ${created} new centers (${centers.length - created} already existed).`);

  console.log("Seeding sample event...");
  await seedSampleEvent();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
