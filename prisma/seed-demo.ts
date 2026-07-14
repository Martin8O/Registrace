// prisma/seed-demo.ts — DEMO / TEST data seeder (one-off, reviewable).
//
// Purpose: provide a realistic, fully-populated state to click through as
// user / ADMIN / SUPER_ADMIN before wider testing. It WIPES all
// Events + Registrations and re-creates 4 fully-described events with realistic
// "family" registrations (10–20 each), then exits.
//
// SAFETY
//  - Destructive: deletes ALL Event + Registration rows (cascades remove their
//    children). KEEPS Center, User, UserCenter, AuditLog.
//  - Guarded: does NOTHING unless run with `--confirm`. Without it, prints the
//    plan (current counts that WOULD be deleted + the 4 events that WOULD be
//    created) and exits.
//  - Deterministic: a seeded PRNG (mulberry32) → re-running yields the same data.
//  - No e-mail is sent (rows are inserted directly). Demo addresses use the
//    RFC-2606 reserved `example.*` domains so a later admin "resend" test cannot
//    reach a real stranger.
//
// Mirrors the LIVE submit path: prices come from the real pricing engine
// (modules/pricing — pure, zero imports) and registration numbers use the real
// YYEEENNNN scheme (frozen Event.numberPrefix + per-event sequence). Invariants
// respected: whole-CZK ints (10), UTC midnight dates (11), children participation
// 0 (15), discounts subtracted, max participants ≤ 10 (19).
//
// RUN:
//   npx tsx --env-file .env.local prisma/seed-demo.ts            # dry-run (plan only)
//   npx tsx --env-file .env.local prisma/seed-demo.ts --confirm  # execute the wipe + seed

import {
  PrismaClient,
  type AgeCategory,
  type PricingType,
  type ArrivalTime,
  type EarlyDeparture,
  type RegistrationStatus,
  type MealCategory,
} from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { calculatePricing } from "../modules/pricing";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const prisma = new PrismaClient({ adapter });

const CONFIRMED = process.argv.includes("--confirm");

// ─── Deterministic PRNG (so re-runs are identical) ────────────────────────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260626);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;
const chance = (p: number) => rand() < p;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const deburr = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// ─── Date / label helpers ─────────────────────────────────────────────────────
const utcMidnight = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function csLabel(date: Date): string {
  const o = { timeZone: "Europe/Prague" } as const;
  const wd = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", ...o }).format(date);
  // Czech `day/month: "numeric"` already emits a trailing dot ("29."), so strip
  // it before re-adding our own — otherwise the label reads "29.. 12." (double dot).
  const d = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", ...o }).format(date).replace(/\.$/, "");
  const m = new Intl.DateTimeFormat("cs-CZ", { month: "numeric", ...o }).format(date).replace(/\.$/, "");
  return `${cap(wd)} ${d}. ${m}.`;
}
function enLabel(date: Date): string {
  const o = { timeZone: "Europe/Prague" } as const;
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "long", ...o }).format(date);
  const d = new Intl.DateTimeFormat("en-GB", { day: "numeric", ...o }).format(date);
  const mon = new Intl.DateTimeFormat("en-GB", { month: "short", ...o }).format(date);
  return `${wd} ${d} ${mon}`;
}

const MEAL_NAMES = {
  BREAKFAST: { cs: "snídaně", en: "breakfast" },
  LUNCH: { cs: "oběd", en: "lunch" },
  DINNER: { cs: "večeře", en: "dinner" },
} as const;
type MealType = keyof typeof MEAL_NAMES;

// Residential meal pattern: arrival day has no breakfast, departure day no dinner.
function mealsForDay(index: number, lastIndex: number): MealType[] {
  const out: MealType[] = [];
  if (index > 0) out.push("BREAKFAST");
  out.push("LUNCH");
  if (index < lastIndex) out.push("DINNER");
  return out;
}

// ─── Czech name pools ─────────────────────────────────────────────────────────
const MALE = ["Jan", "Petr", "Tomáš", "Martin", "Jakub", "Ondřej", "Lukáš", "David", "Pavel", "Marek", "Filip", "Michal", "Vojtěch", "Adam", "Josef"];
const FEMALE = ["Eva", "Jana", "Petra", "Lucie", "Kateřina", "Tereza", "Markéta", "Veronika", "Hana", "Barbora", "Klára", "Anna", "Marie", "Zuzana", "Alena"];
const CHILD_M = ["Adámek", "Matyáš", "Štěpán", "Honzík", "Kuba", "Tobiáš", "Vojta", "Mikuláš"];
const CHILD_F = ["Eliška", "Anička", "Ema", "Sofie", "Natálka", "Klárka", "Rozálka", "Viktorka"];
const SURNAMES: { m: string; f: string }[] = [
  { m: "Novák", f: "Nováková" }, { m: "Svoboda", f: "Svobodová" }, { m: "Novotný", f: "Novotná" },
  { m: "Dvořák", f: "Dvořáková" }, { m: "Černý", f: "Černá" }, { m: "Procházka", f: "Procházková" },
  { m: "Kučera", f: "Kučerová" }, { m: "Veselý", f: "Veselá" }, { m: "Horák", f: "Horáková" },
  { m: "Němec", f: "Němcová" }, { m: "Pokorný", f: "Pokorná" }, { m: "Pospíšil", f: "Pospíšilová" },
  { m: "Hájek", f: "Hájková" }, { m: "Jelínek", f: "Jelínková" }, { m: "Marek", f: "Marková" },
];
const CHILD_AGES = ["AGE_0_3", "AGE_4_7", "AGE_8_14"] as const;
const PRICING_TYPES = ["STANDARD", "SUPPORTED", "SURPLUS"] as const;

// ─── Pricing-rule builder ─────────────────────────────────────────────────────
// Three zero-rate child rules (invariant 15) + three 15+ rules (one per type).
type Adult15 = {
  daily: number; night: number; mA: number; aA: number; eA: number; ed: number;
};
type RuleSeed = {
  ageCategory: AgeCategory; pricingType: PricingType;
  dailyRate: number; nightRate: number;
  morningArrivalDiscount: number; afternoonArrivalDiscount: number;
  eveningArrivalDiscount: number; earlyDepartureDiscount: number;
};
// `age814Daily` lets an event charge ages 8–14 a per-day participation rate
// (revised invariant 15 — real BDC courses like "MLK" do this). Children always
// have zero discounts + zero night rate (those are a 15+-only concept).
function pricingRules(
  p: Record<(typeof PRICING_TYPES)[number], Adult15>,
  age814Daily = 0,
): RuleSeed[] {
  const child = (ageCategory: AgeCategory, dailyRate = 0): RuleSeed => ({
    ageCategory, pricingType: "STANDARD",
    dailyRate, nightRate: 0,
    morningArrivalDiscount: 0, afternoonArrivalDiscount: 0,
    eveningArrivalDiscount: 0, earlyDepartureDiscount: 0,
  });
  const adult = (pricingType: PricingType): RuleSeed => {
    const r = p[pricingType];
    return {
      ageCategory: "AGE_15_PLUS", pricingType,
      dailyRate: r.daily, nightRate: r.night,
      morningArrivalDiscount: r.mA, afternoonArrivalDiscount: r.aA,
      eveningArrivalDiscount: r.eA, earlyDepartureDiscount: r.ed,
    };
  };
  return [
    child("AGE_0_3"), child("AGE_4_7"), child("AGE_8_14", age814Daily),
    adult("STANDARD"), adult("SUPPORTED"), adult("SURPLUS"),
  ];
}

// ─── The 4 demo events ────────────────────────────────────────────────────────
type CreatorKind = "super" | "admin";
type EventSpec = {
  key: string;
  status: "PUBLISHED" | "DRAFT" | "ARCHIVED";
  centerName: string;
  creator: CreatorKind;
  numberPrefix: string;
  title_cs: string; title_en: string;
  subtitle_cs: string; subtitle_en: string;
  description_cs: string; description_en: string;
  contactName: string; contactPhone: string; contactEmail: string;
  days: string[]; // UTC midnight ISO dates, ascending
  maxRegistrations: number | null;
  regCount: number;
  mealPrices: Record<MealType, number>;
  pricing: Record<(typeof PRICING_TYPES)[number], Adult15>;
  // Per-day participation rate for ages 8–14 (default 0). Non-zero on courses
  // that charge older children, e.g. the real BDC "MLK" (100 CZK/day).
  age814Daily?: number;
  // Explicit meals per day index (overrides the default residential pattern).
  // Lets a faithful BDC copy place meals exactly as the source event does.
  mealsByDay?: MealType[][];
};

const EVENTS: EventSpec[] = [
  {
    key: "summer",
    status: "PUBLISHED",
    centerName: "Těnovice",
    creator: "admin",
    numberPrefix: "26001",
    title_cs: "Letní meditační víkend",
    title_en: "Summer Meditation Weekend",
    subtitle_cs: "Otevřeno začátečníkům i pokročilým",
    subtitle_en: "Open to beginners and advanced practitioners",
    description_cs:
      "Třídenní pobytový víkend v klidném prostředí těnovického centra, zaměřený na meditaci na 16. Karmapu. Program vede zkušený cestující učitel; součástí jsou vedené meditace, přednášky, společné vegetariánské jídlo a dostatek prostoru na otázky a odpočinek. Vhodné pro úplné začátečníky i pro ty, kdo už praktikují. Ubytování je přímo v centru, k dispozici je vlastní spacák a karimatka.",
    description_en:
      "A three-day residential weekend in the calm setting of the Těnovice centre, focused on meditation on the 16th Karmapa. Led by an experienced travelling teacher, with guided meditations, talks, shared vegetarian meals and plenty of room for questions and rest. Suitable for complete beginners as well as established practitioners. Accommodation is in the centre itself; bring your own sleeping bag and mat.",
    contactName: "BDC Těnovice",
    contactPhone: "+420 377 100 200",
    contactEmail: "tenovice@bdc.cz",
    days: ["2026-08-14", "2026-08-15", "2026-08-16"],
    maxRegistrations: 30,
    regCount: 17,
    mealPrices: { BREAKFAST: 80, LUNCH: 120, DINNER: 120 },
    pricing: {
      STANDARD: { daily: 250, night: 180, mA: 30, aA: 50, eA: 80, ed: 60 },
      SUPPORTED: { daily: 150, night: 120, mA: 20, aA: 30, eA: 50, ed: 40 },
      SURPLUS: { daily: 350, night: 240, mA: 30, aA: 50, eA: 80, ed: 60 },
    },
  },
  {
    key: "autumn",
    status: "PUBLISHED",
    centerName: "Praha",
    creator: "super",
    numberPrefix: "26002",
    title_cs: "Podzimní kurz Diamantové cesty",
    title_en: "Autumn Diamond Way Course",
    subtitle_cs: "Pětidenní pobytový kurz s cestujícím učitelem",
    subtitle_en: "Five-day residential course with a travelling teacher",
    description_cs:
      "Delší, pětidenní kurz v pražském centru, kde se budeme systematicky věnovat meditační praxi Diamantové cesty. Každý den nabízí ranní i večerní vedené meditace, výklad buddhistických nauk a prostor pro osobní otázky. Kurz je vhodný pro ty, kdo chtějí praxi prohloubit, ale otevřený zůstává i nováčkům. Strava je vegetariánská, ubytování zajištěno v centru a v okolních bytech.",
    description_en:
      "A longer, five-day course at the Prague centre with a systematic focus on Diamond Way meditation practice. Each day offers morning and evening guided meditations, explanation of the Buddhist teachings and space for personal questions. Designed for those who want to deepen their practice, yet open to newcomers too. Vegetarian meals; accommodation provided at the centre and in nearby flats.",
    contactName: "BDC Praha",
    contactPhone: "+420 222 300 400",
    contactEmail: "praha@bdc.cz",
    days: ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"],
    maxRegistrations: 40,
    regCount: 19,
    mealPrices: { BREAKFAST: 90, LUNCH: 130, DINNER: 130 },
    pricing: {
      STANDARD: { daily: 300, night: 200, mA: 40, aA: 60, eA: 90, ed: 70 },
      SUPPORTED: { daily: 180, night: 140, mA: 25, aA: 40, eA: 60, ed: 45 },
      SURPLUS: { daily: 420, night: 280, mA: 40, aA: 60, eA: 90, ed: 70 },
    },
  },
  {
    key: "winter",
    status: "DRAFT",
    centerName: "Karlovy Vary",
    creator: "admin",
    numberPrefix: "26003",
    title_cs: "Zimní pobyt v tichu",
    title_en: "Winter Silent Retreat",
    subtitle_cs: "Tichý pobyt mezi svátky",
    subtitle_en: "Silent retreat between the holidays",
    description_cs:
      "Čtyřdenní tišší pobyt v karlovarském centru mezi vánočními svátky a Novým rokem, ideální pro zklidnění a intenzivnější praxi. Mluvíme jen v nezbytné míře, větší část dne tvoří vedené i samostatné meditace. Počet míst je omezený, aby zůstala zachována klidná atmosféra. (Tato akce je zatím rozpracovaná — koncept, není veřejně zobrazená.)",
    description_en:
      "A quieter, four-day retreat at the Karlovy Vary centre between Christmas and the New Year — ideal for settling the mind and a more intensive practice. We keep talking to a minimum; most of the day is guided and individual meditation. Places are limited to preserve the calm atmosphere. (This event is still a draft — not publicly listed yet.)",
    contactName: "BDC Karlovy Vary",
    contactPhone: "+420 353 600 700",
    contactEmail: "karlovyvary@bdc.cz",
    days: ["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30"],
    maxRegistrations: 24,
    regCount: 11,
    mealPrices: { BREAKFAST: 85, LUNCH: 125, DINNER: 125 },
    pricing: {
      STANDARD: { daily: 280, night: 190, mA: 30, aA: 50, eA: 80, ed: 60 },
      SUPPORTED: { daily: 170, night: 130, mA: 20, aA: 30, eA: 55, ed: 40 },
      SURPLUS: { daily: 390, night: 260, mA: 30, aA: 50, eA: 80, ed: 60 },
    },
  },
  {
    key: "spring",
    status: "ARCHIVED",
    centerName: "Olomouc",
    creator: "super",
    numberPrefix: "26004",
    title_cs: "Jarní víkend 2026",
    title_en: "Spring Weekend 2026",
    subtitle_cs: "Proběhlá akce — archiv",
    subtitle_en: "Past event — archive",
    description_cs:
      "Jarní víkendová akce v olomouckém centru, která už proběhla. Záznam slouží pro archiv a pro práci s registracemi a exporty z minulých akcí. Program zahrnoval vedené meditace, společné jídlo a odpolední procházku.",
    description_en:
      "A spring weekend at the Olomouc centre that has already taken place. Kept for the archive and for working with registrations and exports from past events. The programme included guided meditations, shared meals and an afternoon walk.",
    contactName: "BDC Olomouc",
    contactPhone: "+420 585 800 900",
    contactEmail: "olomouc@bdc.cz",
    days: ["2026-04-10", "2026-04-11", "2026-04-12"],
    maxRegistrations: 30,
    regCount: 13,
    mealPrices: { BREAKFAST: 75, LUNCH: 115, DINNER: 115 },
    pricing: {
      STANDARD: { daily: 230, night: 170, mA: 30, aA: 50, eA: 70, ed: 50 },
      SUPPORTED: { daily: 140, night: 110, mA: 20, aA: 30, eA: 45, ed: 35 },
      SURPLUS: { daily: 330, night: 230, mA: 30, aA: 50, eA: 70, ed: 50 },
    },
  },
  // ── Faithful copies of the LIVE regserver.bdc.cz/tenovice events (prices and
  //    dates/meals taken from the live registration forms). Used
  //    to verify our engine matches theirs. NB: MLK charges ages 8–14 (100/day),
  //    night rate is 0 on both (accommodation adds nothing), arrival discounts are
  //    monotonic (morning ≤ afternoon ≤ evening). Descriptions are concise — the
  //    source pages carry only a title/subtitle. ──
  {
    key: "mlk",
    status: "PUBLISHED",
    centerName: "Těnovice",
    creator: "admin",
    numberPrefix: "26005",
    title_cs: "MLK 2026 – Meditační letní kurz Těnovice",
    title_en: "MLK 2026 – Meditation Summer Course Těnovice",
    subtitle_cs: "Meditační letní kurz",
    subtitle_en: "Meditation summer course",
    description_cs:
      "Hlavní letní meditační kurz v těnovickém centru. Čtyřdenní pobyt (pátek–pondělí) s vedenými meditacemi, přednáškami a společným vegetariánským jídlem. Otevřený začátečníkům i pokročilým. Ubytování v areálu, s sebou vlastní spacák a karimatku.",
    description_en:
      "The main summer meditation course at the Těnovice centre. A four-day stay (Friday–Monday) with guided meditations, talks and shared vegetarian meals. Open to beginners and advanced practitioners. On-site accommodation; bring your own sleeping bag and mat.",
    contactName: "Ondra Rozum",
    contactPhone: "+420 724 051 765",
    contactEmail: "tenovice@bdc.cz",
    days: ["2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06"],
    maxRegistrations: 60,
    regCount: 10,
    mealPrices: { BREAKFAST: 80, LUNCH: 130, DINNER: 130 },
    // Friday: dinner only (course starts Fri evening). Monday: breakfast + lunch.
    mealsByDay: [
      ["DINNER"],
      ["BREAKFAST", "LUNCH", "DINNER"],
      ["BREAKFAST", "LUNCH", "DINNER"],
      ["BREAKFAST", "LUNCH"],
    ],
    age814Daily: 100,
    pricing: {
      STANDARD: { daily: 600, night: 0, mA: 0, aA: 200, eA: 200, ed: 400 },
      SUPPORTED: { daily: 300, night: 0, mA: 0, aA: 200, eA: 200, ed: 400 },
      SURPLUS: { daily: 800, night: 0, mA: 0, aA: 200, eA: 200, ed: 400 },
    },
  },
  {
    key: "prep",
    status: "PUBLISHED",
    centerName: "Těnovice",
    creator: "admin",
    numberPrefix: "26006",
    title_cs: "2. přípravný víkend MLK – Těnovice",
    title_en: "2nd MLK preparatory weekend – Těnovice",
    subtitle_cs: "Přípravný víkend na letní kurz",
    subtitle_en: "Preparatory weekend for the summer course",
    description_cs:
      "Víkendové setkání k přípravě hlavního letního kurzu (MLK) v Těnovicích, pátek–neděle. Společná organizace, úklid, meditace a jídlo. Vhodné pro všechny, kdo chtějí pomoci s přípravou centra.",
    description_en:
      "A weekend gathering to prepare the main summer course (MLK) at Těnovice, Friday–Sunday. Shared organisation, cleaning, meditation and meals. Suitable for anyone who wants to help prepare the centre.",
    contactName: "Ondra Rozum",
    contactPhone: "+420 724 051 765",
    contactEmail: "tenovice@bdc.cz",
    days: ["2026-06-26", "2026-06-27", "2026-06-28"],
    maxRegistrations: 30,
    regCount: 10,
    mealPrices: { BREAKFAST: 80, LUNCH: 120, DINNER: 120 },
    // Friday: dinner only. Sunday: breakfast + lunch (leave after lunch).
    mealsByDay: [
      ["DINNER"],
      ["BREAKFAST", "LUNCH", "DINNER"],
      ["BREAKFAST", "LUNCH"],
    ],
    pricing: {
      STANDARD: { daily: 100, night: 0, mA: 0, aA: 0, eA: 100, ed: 100 },
      SUPPORTED: { daily: 30, night: 0, mA: 0, aA: 0, eA: 100, ed: 100 },
      SURPLUS: { daily: 200, night: 0, mA: 0, aA: 0, eA: 100, ed: 100 },
    },
  },
];

// ─── Family generator ─────────────────────────────────────────────────────────
type GenParticipant = { fullName: string; ageCategory: string; pricingType: string };
function makeFamily(): { participants: GenParticipant[]; email: string } {
  const sur = pick(SURNAMES);
  const adultType = () => {
    const r = rand();
    return r < 0.6 ? "STANDARD" : r < 0.85 ? "SUPPORTED" : "SURPLUS";
  };
  const adult = (): GenParticipant => {
    const male = chance(0.5);
    return {
      fullName: `${pick(male ? MALE : FEMALE)} ${male ? sur.m : sur.f}`,
      ageCategory: "AGE_15_PLUS",
      pricingType: adultType(),
    };
  };
  const child = (): GenParticipant => {
    const boy = chance(0.5);
    return {
      fullName: `${pick(boy ? CHILD_M : CHILD_F)} ${boy ? sur.m : sur.f}`,
      ageCategory: pick([...CHILD_AGES]),
      pricingType: "STANDARD",
    };
  };

  // Household shape — capped at 5 (well under the 10 max).
  const r = rand();
  let participants: GenParticipant[];
  if (r < 0.35) participants = [adult(), adult(), ...Array.from({ length: int(1, 3) }, child)];
  else if (r < 0.55) participants = [adult(), ...Array.from({ length: int(1, 2) }, child)];
  else if (r < 0.8) participants = [adult(), adult()];
  else participants = [adult()];
  participants = participants.slice(0, 5);

  const first = participants[0]!;
  const [fn, ln] = first.fullName.split(" ");
  const email = `${deburr(fn!)}.${deburr(ln!)}${chance(0.4) ? int(1, 99) : ""}`.toLowerCase() +
    "@" + pick(["example.com", "example.org", "example.net"]);
  return { participants, email };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== DEMO SEED ===  (${CONFIRMED ? "EXECUTE" : "DRY-RUN — no changes"})\n`);

  const [eventCount, regCount, participantCount, centers, users] = await Promise.all([
    prisma.event.count(),
    prisma.registration.count(),
    prisma.participant.count(),
    prisma.center.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ include: { centers: { include: { center: true } } } }),
  ]);

  if (centers.length === 0) {
    throw new Error("No active centres found. Run `npx prisma db seed` first to seed centres + admins.");
  }

  const superAdmin = users.find((u) => u.role === "SUPER_ADMIN") ?? null;
  const admins = users.filter((u) => u.role === "ADMIN");
  const centreNamesByUser = new Map(
    users.map((u) => [u.id, new Set(u.centers.map((c) => c.center.name_cs))]),
  );

  // Owner resolution. A "super" event → the SUPER_ADMIN. An "admin" event →
  // an ADMIN who is actually ASSIGNED to that event's centre (the real create-UI
  // scopes the dropdown to the admin's centres, so this mirrors what the app
  // would allow). This is robust to user changes: it picks by centre membership,
  // not by array index. Falls back to the SUPER_ADMIN if no matching admin.
  const adminForCentre = (centerName: string): string | null => {
    const u = users.find((x) => x.role === "ADMIN" && centreNamesByUser.get(x.id)?.has(centerName));
    return u?.id ?? superAdmin?.id ?? null;
  };
  const creatorId = (e: EventSpec): string | null =>
    e.creator === "super" ? (superAdmin?.id ?? null) : adminForCentre(e.centerName);
  const creatorEmail = (e: EventSpec) =>
    users.find((u) => u.id === creatorId(e))?.email ?? "(none)";

  // The seed bypasses the scoping UI, so verify the data we produce would also be
  // valid through the app — warn on any admin-owned event at a non-owned centre.
  const ownerCentreWarning = (e: EventSpec): string => {
    const owner = creatorId(e);
    const u = users.find((x) => x.id === owner);
    if (!owner || !u || u.role === "SUPER_ADMIN") return ""; // super may use any centre
    return centreNamesByUser.get(owner)?.has(e.centerName)
      ? ""
      : `  ⚠ "${e.centerName}" is NOT among ${u.email}'s centres`;
  };

  const centerByName = new Map(centers.map((c) => [c.name_cs, c]));

  console.log("Current DB (would be affected):");
  console.log(`  Events:        ${eventCount}  → DELETE`);
  console.log(`  Registrations: ${regCount}  → DELETE (cascades Participants/Meals)`);
  console.log(`  Participants:  ${participantCount}`);
  console.log(`  Centres:       ${centers.length}  → KEEP`);
  console.log(`  Users/admins:  ${users.length}  → KEEP  (super: ${superAdmin?.email ?? "—"}, admins: ${admins.length})`);
  console.log(`\nWould create ${EVENTS.length} events:`);
  for (const e of EVENTS) {
    const c = centerByName.get(e.centerName);
    console.log(
      `  [${e.status.padEnd(9)}] ${e.title_cs}  @ ${e.centerName}${c ? "" : "  ⚠ centre not found"}  ` +
        `· owner=${creatorEmail(e)} · ~${e.regCount} regs · prefix ${e.numberPrefix}` +
        ownerCentreWarning(e),
    );
  }

  if (!CONFIRMED) {
    console.log("\nDRY-RUN complete. Re-run with `--confirm` to execute the wipe + seed.\n");
    return;
  }

  // ── Wipe (order matters: registrations before events; see header) ──
  console.log("\nDeleting registrations (cascades participants + participant-meals)...");
  const delReg = await prisma.registration.deleteMany({});
  console.log(`  deleted ${delReg.count} registrations`);
  console.log("Deleting events (cascades dates + pricing rules + meals)...");
  const delEv = await prisma.event.deleteMany({});
  console.log(`  deleted ${delEv.count} events`);

  const summary: string[] = [];

  // ── Create each event + its registrations ──
  for (const spec of EVENTS) {
    const center = centerByName.get(spec.centerName);
    if (!center) throw new Error(`Centre "${spec.centerName}" not found — cannot seed event ${spec.key}.`);

    const dayDates = spec.days.map(utcMidnight);
    const startDate = dayDates[0]!;
    const endDate = dayDates[dayDates.length - 1]!;
    const rules = pricingRules(spec.pricing, spec.age814Daily ?? 0);

    const event = await prisma.event.create({
      data: {
        title_cs: spec.title_cs, title_en: spec.title_en,
        subtitle_cs: spec.subtitle_cs, subtitle_en: spec.subtitle_en,
        description_cs: spec.description_cs, description_en: spec.description_en,
        contactName: spec.contactName, contactPhone: spec.contactPhone, contactEmail: spec.contactEmail,
        status: spec.status,
        maxRegistrations: spec.maxRegistrations,
        centerId: center.id,
        createdBy: creatorId(spec),
        startDate, endDate,
        numberPrefix: spec.numberPrefix,
        registrationSeq: 0,
        pricingRules: { create: rules },
      },
    });

    // Dates (sortOrder 1..n) + per-day meals (residential pattern).
    const lastIndex = dayDates.length - 1;
    const dates: { id: string; index: number; sortOrder: number }[] = [];
    const allMeals: { id: string; eventDateId: string; mealType: MealType; price: number; dayIndex: number }[] = [];
    for (let i = 0; i < dayDates.length; i++) {
      const date = dayDates[i]!;
      const sortOrder = i + 1;
      const ed = await prisma.eventDate.create({
        data: { eventId: event.id, date, label_cs: csLabel(date), label_en: enLabel(date), sortOrder },
      });
      dates.push({ id: ed.id, index: i, sortOrder });
      const dayMeals = spec.mealsByDay ? (spec.mealsByDay[i] ?? []) : mealsForDay(i, lastIndex);
      for (const mt of dayMeals) {
        const m = await prisma.eventMeal.create({
          data: {
            eventId: event.id, eventDateId: ed.id, mealType: mt,
            price: spec.mealPrices[mt], isClosed: false,
            label_cs: `${csLabel(date)} – ${MEAL_NAMES[mt].cs}`,
            label_en: `${enLabel(date)} – ${MEAL_NAMES[mt].en}`,
          },
        });
        allMeals.push({ id: m.id, eventDateId: ed.id, mealType: mt, price: spec.mealPrices[mt], dayIndex: i });
      }
    }

    // Engine inputs that don't change per registration.
    const engineRules = rules.map((r) => ({
      ageCategory: r.ageCategory, pricingType: r.pricingType,
      dailyRate: r.dailyRate, nightRate: r.nightRate,
      morningArrivalDiscount: r.morningArrivalDiscount, afternoonArrivalDiscount: r.afternoonArrivalDiscount,
      eveningArrivalDiscount: r.eveningArrivalDiscount, earlyDepartureDiscount: r.earlyDepartureDiscount,
    }));
    const engineMeals = allMeals.map((m) => ({
      id: m.id, eventDateId: m.eventDateId, mealType: m.mealType, price: m.price, isClosed: false,
    }));
    const engineDates = dates.map((d) => ({
      id: d.id, date: dayDates[d.index]!.toISOString().slice(0, 10), sortOrder: d.sortOrder,
    }));
    const priceByMealId = new Map(allMeals.map((m) => [m.id, m.price]));

    // Timestamps: registrations created in the weeks before the event (never in
    // the future relative to "now").
    const nowMs = Date.now();
    const latestMs = Math.min(nowMs, startDate.getTime() - 86_400_000);

    let participantTotal = 0;
    let revenue = 0;
    for (let n = 0; n < spec.regCount; n++) {
      const { participants, email } = makeFamily();

      // Stay window (mostly full stay).
      const aIdx = chance(0.65) ? 0 : int(0, Math.max(0, lastIndex - 1));
      const dIdx = chance(0.7) ? lastIndex : int(aIdx, lastIndex);
      const sameDay = aIdx === dIdx;
      const arrivalDate = dates[aIdx]!;
      const departureDate = dates[dIdx]!;

      const arrivalTime = (sameDay
        ? pick(["MORNING", "AFTERNOON"])
        : aIdx === 0
          ? (chance(0.85) ? pick(["MORNING", "AFTERNOON"]) : "EVENING")
          : pick(["MORNING", "AFTERNOON", "EVENING"])) as ArrivalTime;
      const earlyDeparture = (sameDay
        ? "NONE"
        : chance(0.2)
          ? "AFTER_BREAKFAST"
          : "NONE") as EarlyDeparture;
      const hasAccommodation = sameDay ? false : chance(0.7);

      // Meals available within the stay; each participant takes most of them.
      const stayMeals = allMeals.filter((m) => m.dayIndex >= aIdx && m.dayIndex <= dIdx);
      const perParticipantMealIds = participants.map(() =>
        stayMeals.filter(() => chance(0.85)).map((m) => m.id),
      );

      const pricing = calculatePricing({
        participants: participants.map((p, i) => ({
          ageCategory: p.ageCategory, pricingType: p.pricingType, mealIds: perParticipantMealIds[i]!,
        })),
        pricingRules: engineRules,
        meals: engineMeals,
        eventDates: engineDates,
        arrivalDateId: arrivalDate.id,
        arrivalTime,
        departureDateId: departureDate.id,
        earlyDeparture,
        hasAccommodation,
      });

      // Status / locale / timestamps.
      const sr = rand();
      const status = (spec.status === "ARCHIVED"
        ? sr < 0.6 ? "PAID" : sr < 0.9 ? "REGISTERED" : "CANCELLED"
        : sr < 0.6 ? "REGISTERED" : sr < 0.9 ? "PAID" : "CANCELLED") as RegistrationStatus;
      const locale = chance(0.15) ? "en" : "cs";
      const createdAt = new Date(latestMs - int(0, 30) * 86_400_000 - int(0, 86_400) * 1000);
      const confirmationSentAt =
        status !== "CANCELLED" && chance(0.9)
          ? new Date(createdAt.getTime() + int(1, 15) * 60_000)
          : null;

      const seq = n + 1;
      const registrationNumber = `${spec.numberPrefix}${String(seq).padStart(4, "0")}`;

      await prisma.registration.create({
        data: {
          eventId: event.id,
          centerId: pick(centers).id, // registrant's HOME centre (any active centre)
          arrivalDateId: arrivalDate.id,
          arrivalTime,
          departureDateId: departureDate.id,
          earlyDeparture,
          hasAccommodation,
          email,
          gdprConsent: true,
          totalPrice: pricing.totalPrice,
          status,
          idempotencyKey: randomUUID(),
          ipAddress: null,
          registrationNumber,
          locale,
          createdAt,
          confirmationSentAt,
          participants: {
            create: participants.map((p, i) => {
              const priced = pricing.participants[i]!;
              const mealIds = perParticipantMealIds[i]!;
              return {
                fullName: p.fullName,
                ageCategory: p.ageCategory as AgeCategory,
                pricingType: (p.ageCategory === "AGE_15_PLUS" ? p.pricingType : "STANDARD") as PricingType,
                mealType: (chance(0.7) ? "MEAT" : "VEGETARIAN") as MealCategory,
                participationPrice: priced.participationPrice,
                mealPrice: priced.mealPrice,
                totalPrice: priced.subtotal,
                sortOrder: i,
                meals: {
                  create: mealIds.map((id) => ({ eventMealId: id, price: priceByMealId.get(id)! })),
                },
              };
            }),
          },
        },
      });

      participantTotal += participants.length;
      if (status !== "CANCELLED") revenue += pricing.totalPrice;
    }

    // Advance the event's sequence so future LIVE registrations continue cleanly.
    await prisma.event.update({ where: { id: event.id }, data: { registrationSeq: spec.regCount } });

    const line =
      `[${spec.status.padEnd(9)}] ${spec.title_cs} @ ${spec.centerName} · owner=${creatorEmail(spec)} · ` +
      `${spec.regCount} regs / ${participantTotal} participants · nums ${spec.numberPrefix}0001–${spec.numberPrefix}${String(spec.regCount).padStart(4, "0")} · revenue ${revenue.toLocaleString("cs-CZ")} Kč`;
    summary.push(line);
    console.log("  ✓ " + line);
  }

  console.log("\n=== DONE ===");
  for (const s of summary) console.log("  " + s);
  console.log("\nCentres + admins were kept. AuditLog left as-is.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
