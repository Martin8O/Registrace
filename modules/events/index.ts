// modules/events — server-only event reads (invariant 8: no fat route handlers).
// Maps Prisma rows to DTOs whose shapes are byte-compatible with what the public
// UI already expects (the MockEventDate / MockMealSlot / MockCenter shapes), so
// RegistrationForm needs no changes when the pages switch from mock to DB.

import { prisma } from "@/lib/db";
import type { AdminContext } from "@/modules/auth";
import type { EventCreateWithRelationsInput } from "@/lib/validation";

// ─── DTO types (kept structurally identical to the mock scaffolding) ──────────

export type EventStatusValue = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
export type MealTypeValue = "BREAKFAST" | "LUNCH" | "DINNER";

export type EventDateDTO = {
  id: string;
  date: string; // ISO yyyy-mm-dd (UTC calendar day, displayed Europe/Prague)
  label_cs: string;
  label_en: string;
  sortOrder: number;
};

export type EventMealDTO = {
  id: string;
  eventDateId: string;
  mealType: MealTypeValue;
  price: number; // whole CZK (invariant 10)
  isClosed: boolean;
};

export type CenterDTO = {
  id: string;
  name_cs: string;
  name_en: string;
};

export type PricingRuleDTO = {
  id: string;
  ageCategory: string;
  pricingType: string;
  dailyRate: number;
  nightRate: number;
  morningArrivalDiscount: number;
  afternoonArrivalDiscount: number;
  eveningArrivalDiscount: number;
  earlyDepartureDiscount: number;
};

export type PublishedEventDTO = {
  id: string;
  title_cs: string;
  title_en: string;
  subtitle_cs: string | null;
  subtitle_en: string | null;
  description_cs: string | null;
  description_en: string | null;
  startDate: string; // ISO yyyy-mm-dd
  endDate: string; // ISO yyyy-mm-dd
  status: EventStatusValue;
  center: CenterDTO;
};

export type EventDetailDTO = PublishedEventDTO & {
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  dates: EventDateDTO[];
  meals: EventMealDTO[];
  pricingRules: PricingRuleDTO[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ISO calendar-day string from a stored UTC datetime (we store event days as UTC
// midnight; the calendar day is the UTC day — invariant 11).
function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Minutes that Europe/Prague is ahead of UTC at a given instant. Uses Intl to
// read the zone's wall-clock components for that instant and diffs them against
// the instant's UTC ms. Accurate for any fixed instant.
function pragueOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Prague",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  let hour = get("hour");
  if (hour === 24) hour = 0; // Intl can emit "24" for midnight
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

// The UTC instant for a Prague wall-clock time. A single offset-correction pass
// is exact at 20:00 because DST switches happen at night (~03:00), never at 20:00.
// TODO(deploy): swap the pragmatic Intl math for a tz library if edge DST cases
// ever matter; a real scheduled job (Vercel Cron) will also flip status columns.
function pragueWallClockToUtc(year: number, month: number, day: number, hour: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, 0, 0);
  const offset = pragueOffsetMinutes(new Date(naive));
  return new Date(naive - offset * 60000);
}

// Lifecycle derive-on-read (no scheduler needed for the public list): a PUBLISHED
// event is publicly visible until 20:00 Europe/Prague on its endDate (then
// effectively CLOSED), and effectively ARCHIVED +3 days after endDate.
// TODO(deploy): the real cron writes the actual status; this only derives reads.
export function isPubliclyVisible(
  event: { status: EventStatusValue; endDate: Date },
  now: Date = new Date(),
): boolean {
  if (event.status !== "PUBLISHED") return false;
  const closeAt = pragueWallClockToUtc(
    event.endDate.getUTCFullYear(),
    event.endDate.getUTCMonth() + 1,
    event.endDate.getUTCDate(),
    20,
  );
  return now.getTime() < closeAt.getTime();
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getPublishedEvents(now: Date = new Date()): Promise<PublishedEventDTO[]> {
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    include: { center: true },
    orderBy: { startDate: "asc" },
  });

  return events
    .filter((e) => isPubliclyVisible({ status: e.status, endDate: e.endDate }, now))
    .map((e) => ({
      id: e.id,
      title_cs: e.title_cs,
      title_en: e.title_en,
      subtitle_cs: e.subtitle_cs,
      subtitle_en: e.subtitle_en,
      description_cs: e.description_cs,
      description_en: e.description_en,
      startDate: toIsoDay(e.startDate),
      endDate: toIsoDay(e.endDate),
      status: e.status,
      center: { id: e.center.id, name_cs: e.center.name_cs, name_en: e.center.name_en },
    }));
}

export async function getEventForDetail(id: string): Promise<EventDetailDTO | null> {
  const event = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    include: {
      center: true,
      dates: { orderBy: { sortOrder: "asc" } },
      meals: true,
      pricingRules: true,
    },
  });
  if (!event) return null;

  return {
    id: event.id,
    title_cs: event.title_cs,
    title_en: event.title_en,
    subtitle_cs: event.subtitle_cs,
    subtitle_en: event.subtitle_en,
    description_cs: event.description_cs,
    description_en: event.description_en,
    contactName: event.contactName,
    contactPhone: event.contactPhone,
    contactEmail: event.contactEmail,
    startDate: toIsoDay(event.startDate),
    endDate: toIsoDay(event.endDate),
    status: event.status,
    center: { id: event.center.id, name_cs: event.center.name_cs, name_en: event.center.name_en },
    dates: event.dates.map((d) => ({
      id: d.id,
      date: toIsoDay(d.date),
      label_cs: d.label_cs,
      label_en: d.label_en,
      sortOrder: d.sortOrder,
    })),
    meals: event.meals.map((m) => ({
      id: m.id,
      eventDateId: m.eventDateId,
      mealType: m.mealType,
      price: m.price,
      isClosed: m.isClosed,
    })),
    pricingRules: event.pricingRules.map((r) => ({
      id: r.id,
      ageCategory: r.ageCategory,
      pricingType: r.pricingType,
      dailyRate: r.dailyRate,
      nightRate: r.nightRate,
      morningArrivalDiscount: r.morningArrivalDiscount,
      afternoonArrivalDiscount: r.afternoonArrivalDiscount,
      eveningArrivalDiscount: r.eveningArrivalDiscount,
      earlyDepartureDiscount: r.earlyDepartureDiscount,
    })),
  };
}

export async function getCentersForSelect(): Promise<CenterDTO[]> {
  const centers = await prisma.center.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name_cs: true, name_en: true },
  });
  return centers;
}

// ─── Admin writes / scoped reads (ownership — invariant 20) ────────────────────

// Thrown when an ADMIN tries to create an event for a centre they don't
// administer. Handlers map it to HTTP 403.
export class EventOwnershipError extends Error {
  constructor(message = "Center not assigned to this admin") {
    super(message);
    this.name = "EventOwnershipError";
  }
}

export type AdminEventListItem = {
  id: string;
  title_cs: string;
  title_en: string;
  status: EventStatusValue;
  startDate: string;
  endDate: string;
  center: CenterDTO;
};

// Localized meal-type words for the auto-derived EventMeal labels (server-side;
// email/DB labels are outside the next-intl request scope — mirrors the seed).
const MEAL_LABEL_CS: Record<string, string> = { BREAKFAST: "snídaně", LUNCH: "oběd", DINNER: "večeře" };
const MEAL_LABEL_EN: Record<string, string> = { BREAKFAST: "breakfast", LUNCH: "lunch", DINNER: "dinner" };

// Create an event + its dates, pricing rules and meals in ONE transaction.
// `createdBy` comes only from the session context (never the request body —
// memory b7-createdby-from-session). ADMIN may only create for an assigned
// centre; SUPER_ADMIN may use any centre (invariant 20).
export async function createEvent(
  input: EventCreateWithRelationsInput,
  ctx: AdminContext,
): Promise<{ id: string }> {
  if (ctx.role === "ADMIN" && !ctx.centerIds.includes(input.centerId)) {
    throw new EventOwnershipError();
  }

  // Day label lookup for deriving meal labels.
  const dayLabels = new Map(input.dates.map((d) => [d.date, { cs: d.label_cs, en: d.label_en }]));

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        title_cs: input.title_cs,
        title_en: input.title_en,
        subtitle_cs: input.subtitle_cs ?? null,
        subtitle_en: input.subtitle_en ?? null,
        description_cs: input.description_cs || null,
        description_en: input.description_en || null,
        contactName: input.contactName || null,
        contactPhone: input.contactPhone || null,
        contactEmail: input.contactEmail || null,
        status: input.status,
        maxRegistrations: input.maxRegistrations ?? null,
        centerId: input.centerId,
        createdBy: ctx.userId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    });

    // Dates first — capture each created id keyed by its ISO date.
    const dateIdByIso = new Map<string, string>();
    for (const d of input.dates) {
      const created = await tx.eventDate.create({
        data: {
          eventId: event.id,
          date: new Date(d.date),
          label_cs: d.label_cs,
          label_en: d.label_en,
          sortOrder: d.sortOrder,
        },
      });
      dateIdByIso.set(d.date, created.id);
    }

    if (input.pricingRules.length > 0) {
      await tx.pricingRule.createMany({
        data: input.pricingRules.map((r) => ({ eventId: event.id, ...r })),
      });
    }

    for (const m of input.meals) {
      const eventDateId = dateIdByIso.get(m.date);
      if (!eventDateId) continue; // skip meals whose date isn't an event day
      const label = dayLabels.get(m.date);
      await tx.eventMeal.create({
        data: {
          eventId: event.id,
          eventDateId,
          mealType: m.mealType,
          price: m.price,
          isClosed: m.isClosed,
          label_cs: `${label?.cs ?? ""} – ${MEAL_LABEL_CS[m.mealType] ?? m.mealType}`,
          label_en: `${label?.en ?? ""} – ${MEAL_LABEL_EN[m.mealType] ?? m.mealType}`,
        },
      });
    }

    return { id: event.id };
  });
}

// ADMIN sees only events they created; SUPER_ADMIN sees all (invariant 20).
export async function listAdminEvents(ctx: AdminContext): Promise<AdminEventListItem[]> {
  const events = await prisma.event.findMany({
    where: {
      deletedAt: null,
      ...(ctx.role === "ADMIN" ? { createdBy: ctx.userId } : {}),
    },
    include: { center: true },
    orderBy: { startDate: "desc" },
  });

  return events.map((e) => ({
    id: e.id,
    title_cs: e.title_cs,
    title_en: e.title_en,
    status: e.status,
    startDate: toIsoDay(e.startDate),
    endDate: toIsoDay(e.endDate),
    center: { id: e.center.id, name_cs: e.center.name_cs, name_en: e.center.name_en },
  }));
}
