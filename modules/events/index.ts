// modules/events — server-only event reads (invariant 8: no fat route handlers).
// Maps Prisma rows to DTOs whose shapes are byte-compatible with what the public
// UI already expects (the MockEventDate / MockMealSlot / MockCenter shapes), so
// RegistrationForm needs no changes when the pages switch from mock to DB.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { AdminContext } from "@/modules/auth";
import type { EventCreateWithRelationsInput, EventUpdateInput } from "@/lib/validation";
import { logAuditEvent } from "@/lib/audit";

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
  // Meal-ordering cut-off as a UTC ISO string (or null = no deadline). The public
  // form compares it against `now` to close meal selection; the admin edit form
  // converts it to a Prague wall-clock datetime-local for display.
  mealRegistrationDeadline: string | null;
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

// Convert a Europe/Prague wall-clock "YYYY-MM-DDTHH:mm" (a <input
// type="datetime-local"> value) into the matching UTC instant — handles SELČ/SEČ
// automatically by reading the zone offset at that instant. Returns null for a
// malformed string.
export function pragueLocalToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = pragueOffsetMinutes(new Date(naive));
  return new Date(naive - offset * 60000);
}

// Inverse: a UTC instant → Europe/Prague wall-clock "YYYY-MM-DDTHH:mm" (for
// prefilling the datetime-local input in the edit form).
export function formatPragueDateTimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
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
    mealRegistrationDeadline: event.mealRegistrationDeadline
      ? event.mealRegistrationDeadline.toISOString()
      : null,
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

// Centres the caller may CREATE an event for (the event-create dropdown). ADMIN
// sees only their assigned centres (matches the createEvent ownership guard:
// createEvent throws EventOwnershipError if an ADMIN picks a non-assigned
// centre); SUPER_ADMIN sees all. Returns [] for an ADMIN with no centres — the
// form then shows a "no assigned centre" notice instead of an empty picker.
export async function getCentersForAdminSelect(ctx: AdminContext): Promise<CenterDTO[]> {
  const all = await getCentersForSelect();
  if (ctx.role === "SUPER_ADMIN") return all;
  return all.filter((c) => ctx.centerIds.includes(c.id));
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

// Thrown when a manual status change would hide a live event from people who
// already hold its public link — un-publishing (→ DRAFT) an event that already
// has registrations. Handlers map it to HTTP 409. (Other transitions stay open;
// public visibility is otherwise time-bounded by isPubliclyVisible.)
export class EventStatusTransitionError extends Error {
  constructor(message = "Cannot unpublish an event that already has registrations") {
    super(message);
    this.name = "EventStatusTransitionError";
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

  const created = await prisma.$transaction(async (tx) => {
    // Freeze the registration-number prefix: YY (event's year) + its per-year
    // ordinal (the Nth event of that year, counting all incl. soft-deleted so
    // numbers are never reused). The @unique on numberPrefix guards the rare
    // concurrent-create collision. Year basis = UTC, matching the backfill.
    const year = input.startDate.getUTCFullYear();
    const priorThisYear = await tx.event.count({
      where: {
        startDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    });
    const numberPrefix = `${String(year).slice(-2)}${String(priorThisYear + 1).padStart(3, "0")}`;

    const event = await tx.event.create({
      data: {
        numberPrefix,
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
        mealRegistrationDeadline: input.mealRegistrationDeadline
          ? pragueLocalToUtc(input.mealRegistrationDeadline)
          : null,
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

    return {
      id: event.id,
      snapshot: {
        title_cs: event.title_cs,
        title_en: event.title_en,
        centerId: event.centerId,
        status: event.status,
        maxRegistrations: event.maxRegistrations,
        startDate: event.startDate.toISOString(),
        endDate: event.endDate.toISOString(),
      },
    };
  });

  // Audit AFTER the transaction commits — best-effort, never blocks the write (P4).
  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "event.create",
    entityType: "Event",
    entityId: created.id,
    newData: created.snapshot,
  });

  return { id: created.id };
}

// Dashboard counts, role-scoped (invariant 20). ADMIN: only events they created
// + the registrations on those events; SUPER_ADMIN: all. Soft-deleted rows
// (deletedAt) are excluded on both entities.
export async function getAdminDashboardCounts(
  ctx: AdminContext,
): Promise<{ events: number; registrations: number }> {
  // ADMIN is scoped to the events of their assigned centres (not by who created
  // them — a centre can have several admins; invariant 20). SUPER_ADMIN: all.
  const ownEvents = ctx.role === "ADMIN" ? { centerId: { in: ctx.centerIds } } : {};
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

// ADMIN sees all events of their assigned centres; SUPER_ADMIN sees all
// (invariant 20). Scope is by centre, not by creator — a centre may have several
// admins who all manage its events.
export async function listAdminEvents(ctx: AdminContext): Promise<AdminEventListItem[]> {
  const events = await prisma.event.findMany({
    where: {
      deletedAt: null,
      ...(ctx.role === "ADMIN" ? { centerId: { in: ctx.centerIds } } : {}),
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
  // How many registrations reference this event (any status, incl. soft-deleted).
  // A DRAFT with zero is fully editable (centre/dates/pricing/meals); otherwise
  // those are locked because existing rows depend on the EventDate/EventMeal ids.
  registrationCount: number;
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
  if (ctx.role === "ADMIN" && !ctx.centerIds.includes(event.centerId)) return null;
  // Count ALL registrations (any status, incl. soft-deleted): even a soft-deleted
  // row's ParticipantMeal references this event's EventMeal ids, so the relations
  // can only be wiped/replaced when truly nothing points at them.
  const registrationCount = await prisma.registration.count({ where: { eventId: id } });
  return {
    ...toEventDetailDTO(event),
    centerId: event.centerId,
    maxRegistrations: event.maxRegistrations,
    registrationCount,
  };
}

// Load an event for an update + assert the caller may touch it, returning the
// scalar pre-image (audit oldData), its status, and how many registrations
// reference it. Missing → 404; ADMIN-not-owner → 403.
async function loadEventForUpdate(id: string, ctx: AdminContext) {
  const event = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    select: {
      centerId: true,
      title_cs: true,
      title_en: true,
      subtitle_cs: true,
      subtitle_en: true,
      description_cs: true,
      description_en: true,
      contactName: true,
      contactPhone: true,
      contactEmail: true,
      maxRegistrations: true,
      status: true,
      _count: { select: { registrations: true } },
    },
  });
  if (!event) throw new EventNotFoundError();
  if (ctx.role === "ADMIN" && !ctx.centerIds.includes(event.centerId)) throw new EventOwnershipError();
  const { _count, ...before } = event;
  return { before, status: event.status, registrationCount: _count.registrations };
}

// Update an existing event. A DRAFT with zero registrations is fully editable —
// centre, dates, pricing and meals are replaced wholesale (nothing depends on
// them yet) — see replaceDraftEventRelations. Otherwise only the scalar fields
// are writable (§0 decision 1): centre/startDate/endDate/relations are immutable
// because existing registrations reference those EventDate/EventMeal ids.
export async function updateEvent(
  id: string,
  input: EventUpdateInput,
  ctx: AdminContext,
): Promise<{ id: string }> {
  const { before, status, registrationCount } = await loadEventForUpdate(id, ctx);

  // The full payload (with relation arrays) only takes effect for an editable
  // draft; a locked event ignores centre/dates/relations even if they're sent.
  const relationsEditable = status === "DRAFT" && registrationCount === 0;
  const hasRelations =
    input.dates !== undefined && input.pricingRules !== undefined && input.meals !== undefined;
  if (relationsEditable && hasRelations) {
    return replaceDraftEventRelations(id, input, before, ctx);
  }

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
  if (input.mealRegistrationDeadline !== undefined) {
    data.mealRegistrationDeadline = input.mealRegistrationDeadline
      ? pragueLocalToUtc(input.mealRegistrationDeadline)
      : null;
  }
  if (input.status !== undefined) data.status = input.status;

  // No writable field present (e.g. a payload of only immutable centerId/dates):
  // skip the no-op DB write AND the misleading empty-newData audit row.
  if (Object.keys(data).length === 0) return { id };

  await prisma.event.update({ where: { id }, data });

  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "event.update",
    entityType: "Event",
    entityId: id,
    oldData: before, // pre-image of the editable scalars (+ createdBy/status)
    newData: data, // only the fields actually changed
  });

  return { id };
}

// Full replace for an editable DRAFT (no registrations): updates scalars +
// centre + start/end dates, then wipes and recreates the event's dates, pricing
// rules and meals in one transaction. Safe because nothing references the old
// EventDate/EventMeal/PricingRule ids yet. numberPrefix is intentionally left
// frozen (set at create) — a draft has no registration numbers to keep in sync.
async function replaceDraftEventRelations(
  id: string,
  input: EventUpdateInput,
  before: { centerId: string },
  ctx: AdminContext,
): Promise<{ id: string }> {
  // An ADMIN may only move a draft to one of their own centres (SUPER_ADMIN: any).
  if (input.centerId && ctx.role === "ADMIN" && !ctx.centerIds.includes(input.centerId)) {
    throw new EventOwnershipError();
  }

  const dates = input.dates ?? [];
  const pricingRules = input.pricingRules ?? [];
  const meals = input.meals ?? [];
  const dayLabels = new Map(dates.map((d) => [d.date, { cs: d.label_cs, en: d.label_en }]));

  await prisma.$transaction(async (tx) => {
    // 1) Scalars + centre + dates + deadline.
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
    if (input.centerId !== undefined) data.center = { connect: { id: input.centerId } };
    if (input.startDate !== undefined) data.startDate = input.startDate;
    if (input.endDate !== undefined) data.endDate = input.endDate;
    if (input.mealRegistrationDeadline !== undefined) {
      data.mealRegistrationDeadline = input.mealRegistrationDeadline
        ? pragueLocalToUtc(input.mealRegistrationDeadline)
        : null;
    }
    await tx.event.update({ where: { id }, data });

    // 2) Wipe old relations (EventMeal first — it references EventDate).
    await tx.eventMeal.deleteMany({ where: { eventId: id } });
    await tx.pricingRule.deleteMany({ where: { eventId: id } });
    await tx.eventDate.deleteMany({ where: { eventId: id } });

    // 3) Recreate them (mirrors createEvent's relation writes).
    const dateIdByIso = new Map<string, string>();
    for (const d of dates) {
      const created = await tx.eventDate.create({
        data: {
          eventId: id,
          date: new Date(d.date),
          label_cs: d.label_cs,
          label_en: d.label_en,
          sortOrder: d.sortOrder,
        },
      });
      dateIdByIso.set(d.date, created.id);
    }
    if (pricingRules.length > 0) {
      await tx.pricingRule.createMany({
        data: pricingRules.map((r) => ({ eventId: id, ...r })),
      });
    }
    const mealData = meals.flatMap((m) => {
      const eventDateId = dateIdByIso.get(m.date);
      if (!eventDateId) return [];
      const label = dayLabels.get(m.date);
      return [
        {
          eventId: id,
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
  });

  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "event.update",
    entityType: "Event",
    entityId: id,
    oldData: before,
    newData: {
      centerId: input.centerId,
      startDate: input.startDate?.toISOString(),
      endDate: input.endDate?.toISOString(),
      status: input.status,
      replacedRelations: true,
    },
  });

  return { id };
}

// Change only the event's lifecycle status (the PATCH endpoint). Same ownership
// rules as updateEvent. Manual transition — the real cron is a deploy concern.
export async function setEventStatus(
  id: string,
  status: EventStatusValue,
  ctx: AdminContext,
): Promise<{ id: string }> {
  const { before, registrationCount } = await loadEventForUpdate(id, ctx);

  // Guard the one transition that harms registrants: un-publishing a live event
  // (PUBLISHED/CLOSED → DRAFT) that already has registrations would hide it from
  // everyone holding its public link. Every other transition stays permitted.
  if (status === "DRAFT" && before.status !== "DRAFT" && registrationCount > 0) {
    throw new EventStatusTransitionError();
  }

  await prisma.event.update({ where: { id }, data: { status } });

  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "event.status_change",
    entityType: "Event",
    entityId: id,
    oldData: { status: before.status },
    newData: { status },
  });

  return { id };
}
