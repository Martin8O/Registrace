// prisma/seed — the centre rows, and nothing else.
//
// Run by `npx prisma db seed` (wired in prisma.config.ts), which is a DOCUMENTED
// SETUP STEP every instance runs, production included. So it must only create what
// every instance genuinely needs: the Center rows the registration form selects
// from. It is idempotent — existing centres are left alone — and it deletes
// nothing.
//
// It used to also seed a PUBLISHED sample event, added during the build so the
// public reads had something to render. That was removed: on a real instance the
// documented setup command put a fictional event on the public homepage. Demo data
// does not belong in the one command everybody has to run. Create events from the
// admin panel; the older truncating demo seeder is gone too (see git history).
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
