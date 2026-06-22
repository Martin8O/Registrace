// modules/events — server-only event reads (invariant 8: no fat route handlers).
// Maps Prisma rows to DTOs whose shapes are byte-compatible with what the public
// UI already expects (the MockEventDate / MockMealSlot / MockCenter shapes), so
// RegistrationForm needs no changes when the pages switch from mock to DB.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { AdminContext } from "@/modules/auth";
import type { EventCreateWithRelationsInput, EventUpdateInput } from "@/lib/validation";

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

// One include shape reused by the public detail read and the admin edit load,
// so both map identically (the edit DTO just adds a couple of admin-only fields).
const eventDetailInclude = {
  center: true,
  dates: { orderBy: { sortOrder: "asc" } },
  meals: true,
  pricingRules: true,
} satisfies Prisma.EventInclude;

type EventDetailRow = Prisma.EventGetPayload<{ include: typeof eventDetailInclude }>;

// Prisma row → EventDetailDTO (the shared mapper for both reads).
function toEventDetailDTO(event: EventDetailRow): EventDetailDTO {
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

export async function getEventForDetail(id: string): Promise<EventDetailDTO | null> {
  const event = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    include: eventDetailInclude,
  });
  return event ? toEventDetailDTO(event) : null;
}

// PUBLIC detail read (P1 audit H1): same as getEventForDetail but enforces the
// public-visibility rule used by the list + submit, so non-PUBLISHED / past events
// (incl. DRAFT contact PII) never leak. Returns null when not publicly visible.
export async function getPublicEventForDetail(
  id: string,
  now: Date = new Date(),
): Promise<EventDetailDTO | null> {
  const event = await getEventForDetail(id);
  if (!event) return null;
  // getEventForDetail returns endDate as an ISO yyyy-mm-dd (UTC) string; rebuild a
  // Date for the predicate (parses as UTC midnight — same calendar day, invariant 11).
  if (!isPubliclyVisible({ status: event.status, endDate: new Date(event.endDate) }, now)) {
    return null;
  }
  return event;
}

// "Jiné" / "Mimo ČR" are pinned to the end of every picker via a deliberately
// high sortOrder (≥ this threshold, set in the seed). Everything else — including
// admin-created centres, which get a normal-band sortOrder (see createCenter) —
// is shown in Czech alphabetical order by name, so new centres slot in correctly
// instead of landing after the specials.
const SPECIAL_SORT_ORDER_MIN = 240;

export async function getCentersForSelect(): Promise<CenterDTO[]> {
  const centers = await prisma.center.findMany({
    where: { isActive: true },
    select: { id: true, name_cs: true, name_en: true, sortOrder: true },
  });
  return centers
    .slice()
    .sort((a, b) => {
      const aSpecial = a.sortOrder >= SPECIAL_SORT_ORDER_MIN;
      const bSpecial = b.sortOrder >= SPECIAL_SORT_ORDER_MIN;
      if (aSpecial !== bSpecial) return aSpecial ? 1 : -1; // specials last
      if (aSpecial && bSpecial) return a.sortOrder - b.sortOrder; // keep Jiné before Mimo ČR
      return a.name_cs.localeCompare(b.name_cs, "cs"); // normals: alphabetical
    })
    .map(({ id, name_cs, name_en }) => ({ id, name_cs, name_en }));
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

// Thrown when an edit/status write targets an event that doesn't exist (or is
// soft-deleted). Handlers map it to HTTP 404. (Ownership failures throw
// EventOwnershipError → 403; a not-found never reveals another admin's event.)
export class EventNotFoundError extends Error {
  constructor(message = "Event not found") {
    super(message);
    this.name = "EventNotFoundError";
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

    // Batch the meals into one INSERT (P1 audit M5 — was a per-meal create loop).
    // Meals whose date isn't an event day are skipped.
    const mealData = input.meals.flatMap((m) => {
      const eventDateId = dateIdByIso.get(m.date);
      if (!eventDateId) return [];
      const label = dayLabels.get(m.date);
      return [
        {
          eventId: event.id,
          eventDateId,
          mealType: m.mealType,
          price: m.price,
          isClosed: m.isClosed,
          label_cs: `${label?.cs ?? ""} – ${MEAL_LABEL_CS[m.mealType] ?? m.mealType}`,
          label_en: `${label?.en ?? ""} – ${MEAL_LABEL_EN[m.mealType] ?? m.mealType}`,
        },
      ];
    });
    if (mealData.length > 0) {
      await tx.eventMeal.createMany({ data: mealData });
    }

    return { id: event.id };
  });
}

// Dashboard counts, role-scoped (invariant 20). ADMIN: only events they created
// + the registrations on those events; SUPER_ADMIN: all. Soft-deleted rows
// (deletedAt) are excluded on both entities.
export async function getAdminDashboardCounts(
  ctx: AdminContext,
): Promise<{ events: number; registrations: number }> {
  const ownEvents = ctx.role === "ADMIN" ? { createdBy: ctx.userId } : {};
  const [events, registrations] = await Promise.all([
    prisma.event.count({ where: { deletedAt: null, ...ownEvents } }),
    prisma.registration.count({
      where: {
        deletedAt: null,
        // A registration belongs to an admin iff its event is theirs.
        event: { deletedAt: null, ...ownEvents },
      },
    }),
  ]);
  return { events, registrations };
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

// ─── Admin event edit (P2.5 — scalar fields + status only, §0 decision 1) ──────

// The edit form needs everything the detail DTO has plus a couple of admin-only
// scalars (centerId for the read-only display, maxRegistrations for the form).
export type EventEditDTO = EventDetailDTO & {
  centerId: string;
  maxRegistrations: number | null;
};

// Load an event for editing, ownership-scoped. Returns null when the event is
// missing OR (for an ADMIN) owned by someone else — the edit page maps null to
// notFound(), which also avoids confirming another admin's event exists.
export async function getEventForEdit(
  id: string,
  ctx: AdminContext,
): Promise<EventEditDTO | null> {
  const event = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    include: eventDetailInclude,
  });
  if (!event) return null;
  if (ctx.role === "ADMIN" && event.createdBy !== ctx.userId) return null;
  return { ...toEventDetailDTO(event), centerId: event.centerId, maxRegistrations: event.maxRegistrations };
}

// Re-fetch an event for a write and assert the caller may touch it. Missing →
// EventNotFoundError (404); ADMIN-not-owner → EventOwnershipError (403).
async function assertEventWritable(id: string, ctx: AdminContext): Promise<void> {
  const event = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    select: { createdBy: true },
  });
  if (!event) throw new EventNotFoundError();
  if (ctx.role === "ADMIN" && event.createdBy !== ctx.userId) throw new EventOwnershipError();
}

// Update an existing event's SCALAR fields only (§0 decision 1). centerId,
// startDate, endDate and all relations (dates/meals/pricing) are immutable here
// even if present in the payload — existing registrations reference those ids.
export async function updateEvent(
  id: string,
  input: EventUpdateInput,
  ctx: AdminContext,
): Promise<{ id: string }> {
  await assertEventWritable(id, ctx);

  // Whitelist: only these scalar columns are writable. Anything else in the
  // validated payload (centerId/startDate/endDate) is deliberately ignored.
  const data: Prisma.EventUpdateInput = {};
  if (input.title_cs !== undefined) data.title_cs = input.title_cs;
  if (input.title_en !== undefined) data.title_en = input.title_en;
  if (input.subtitle_cs !== undefined) data.subtitle_cs = input.subtitle_cs || null;
  if (input.subtitle_en !== undefined) data.subtitle_en = input.subtitle_en || null;
  if (input.description_cs !== undefined) data.description_cs = input.description_cs || null;
  if (input.description_en !== undefined) data.description_en = input.description_en || null;
  if (input.contactName !== undefined) data.contactName = input.contactName || null;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone || null;
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail || null;
  if (input.maxRegistrations !== undefined) data.maxRegistrations = input.maxRegistrations;
  if (input.status !== undefined) data.status = input.status;

  await prisma.event.update({ where: { id }, data });
  return { id };
}

// Change only the event's lifecycle status (the PATCH endpoint). Same ownership
// rules as updateEvent. Manual transition — the real cron is a deploy concern.
export async function setEventStatus(
  id: string,
  status: EventStatusValue,
  ctx: AdminContext,
): Promise<{ id: string }> {
  await assertEventWritable(id, ctx);
  await prisma.event.update({ where: { id }, data: { status } });
  return { id };
}
