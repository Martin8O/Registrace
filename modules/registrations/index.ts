// modules/registrations — the public registration submit (invariant 8: no fat
// route handlers). One idempotent transaction persists Registration +
// Participant + ParticipantMeal rows with server-recomputed prices (via the
// modules/pricing seam — zeros until P5, invariants 3–4), then sends the
// confirmation email OUTSIDE the transaction (invariant 6: email failure is
// non-blocking and never rolls anything back).

import { prisma } from "@/lib/db";
import { calculatePricing } from "@/modules/pricing";
import { isPubliclyVisible, type EventMealDTO, type PricingRuleDTO } from "@/modules/events";
import { sendRegistrationConfirmation, type ConfirmationEmailData } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";
import type { AdminContext } from "@/modules/auth";
import type {
  RegistrationSubmitInput,
  RegistrationUpdateInput,
  RegistrationExportInput,
} from "@/lib/validation";
import type { ExportTable } from "@/lib/export/csv";

// ─── Typed errors (handlers map them to HTTP statuses) ────────────────────────

// Event missing, soft-deleted, or no longer publicly visible → 404.
export class RegistrationEventNotFoundError extends Error {
  constructor(message = "Event not found") {
    super(message);
    this.name = "RegistrationEventNotFoundError";
  }
}

// maxRegistrations reached (checked INSIDE the transaction) → 409.
export class RegistrationCapacityError extends Error {
  constructor(message = "Event capacity reached") {
    super(message);
    this.name = "RegistrationCapacityError";
  }
}

// Client-sent ids that don't belong to the event (tampered payload) → 400.
export class RegistrationStayMismatchError extends Error {
  constructor(message = "Stay dates do not belong to this event") {
    super(message);
    this.name = "RegistrationStayMismatchError";
  }
}

// Admin edit/resend targets a missing (or soft-deleted) registration → 404.
export class RegistrationNotFoundError extends Error {
  constructor(message = "Registration not found") {
    super(message);
    this.name = "RegistrationNotFoundError";
  }
}

// Admin edit/resend targets a registration on another admin's event → 403.
export class RegistrationForbiddenError extends Error {
  constructor(message = "Registration not accessible to this admin") {
    super(message);
    this.name = "RegistrationForbiddenError";
  }
}

export type SubmitMeta = {
  ipAddress: string | null; // stored for rate-limiting only (P4)
  lang: "cs" | "en"; // confirmation-email language
};

export type SubmitResult = {
  registrationId: string;
  confirmationSent: boolean;
};

const HONEYPOT_SENTINEL = "bot-detected";

export async function submitRegistration(
  input: RegistrationSubmitInput,
  meta: SubmitMeta,
): Promise<SubmitResult> {
  // Honeypot (invariant 18): pretend success, write nothing. (The handler
  // already short-circuits this on the raw body; this guard keeps the service
  // safe regardless of caller.)
  if (input.honeypot !== undefined && input.honeypot !== "") {
    console.warn(`[registrations] honeypot triggered (ip: ${meta.ipAddress ?? "unknown"})`);
    return { registrationId: HONEYPOT_SENTINEL, confirmationSent: false };
  }

  // Idempotency (invariant 14): a replayed key returns the existing row, no
  // re-insert and no second email.
  const existing = await prisma.registration.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return {
      registrationId: existing.id,
      confirmationSent: existing.confirmationSentAt !== null,
    };
  }

  const event = await prisma.event.findFirst({
    where: { id: input.eventId, deletedAt: null },
    include: {
      center: true,
      dates: { orderBy: { sortOrder: "asc" } },
      meals: true,
      pricingRules: true,
    },
  });
  if (!event || !isPubliclyVisible({ status: event.status, endDate: event.endDate })) {
    throw new RegistrationEventNotFoundError();
  }

  // Anti-tampering: arrival/departure must be days OF this event, and the home
  // centre must exist (the FK alone would accept any event's EventDate id).
  const dateById = new Map(event.dates.map((d) => [d.id, d]));
  const arrivalDate = dateById.get(input.arrivalDateId);
  const departureDate = dateById.get(input.departureDateId);
  if (!arrivalDate || !departureDate) {
    throw new RegistrationStayMismatchError();
  }

  // Stay-order rules (mirrored client-side as disabled pills): departure never
  // precedes arrival; a same-day visit cannot arrive in the evening; same-day
  // "after breakfast" departure requires a morning arrival.
  if (departureDate.sortOrder < arrivalDate.sortOrder) {
    throw new RegistrationStayMismatchError("Departure cannot precede arrival");
  }
  if (departureDate.sortOrder === arrivalDate.sortOrder) {
    if (input.arrivalTime === "EVENING") {
      throw new RegistrationStayMismatchError("Same-day stay cannot arrive in the evening");
    }
    if (input.earlyDeparture === "AFTER_BREAKFAST" && input.arrivalTime !== "MORNING") {
      throw new RegistrationStayMismatchError(
        "Same-day early departure requires a morning arrival",
      );
    }
  }
  const center = await prisma.center.findFirst({
    where: { id: input.centerId, isActive: true },
    select: { id: true, name_cs: true, name_en: true },
  });
  if (!center) {
    throw new RegistrationStayMismatchError("Unknown center");
  }

  // Selected meals: only ids that belong to this event AND are not closed
  // survive; anything else from the client is silently dropped. Deduped —
  // ParticipantMeal has @@unique([participantId, eventMealId]).
  const mealById = new Map(event.meals.map((m) => [m.id, m]));

  // Meal-ordering deadline (server-authoritative): once it has passed, no meals
  // may be booked for this event. Strip every participant's meal selection so the
  // pricing, persisted ParticipantMeal rows, and email all agree (the public form
  // also disables the checkboxes, but the server is the gate).
  const mealsClosed =
    event.mealRegistrationDeadline !== null &&
    Date.now() >= event.mealRegistrationDeadline.getTime();
  const participantsInput = input.participants.map((p) => ({
    ...p,
    mealIds: mealsClosed ? [] : p.mealIds,
  }));

  // Server-authoritative recompute via the pricing seam (invariants 3–4). The
  // client sends no prices and none would be trusted.
  const pricing = calculatePricing({
    participants: participantsInput.map((p) => ({
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealIds: p.mealIds,
    })),
    pricingRules: event.pricingRules,
    meals: event.meals,
    eventDates: event.dates.map((d) => ({
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      sortOrder: d.sortOrder,
    })),
    arrivalDateId: input.arrivalDateId,
    arrivalTime: input.arrivalTime,
    departureDateId: input.departureDateId,
    earlyDeparture: input.earlyDeparture,
    hasAccommodation: input.hasAccommodation,
  });

  let registrationId: string;
  let registrationNumber: string | null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Capacity re-checked inside the transaction so concurrent submits can't
      // both pass the gate → 409.
      if (event.maxRegistrations !== null) {
        const taken = await tx.registration.count({
          where: { eventId: event.id, deletedAt: null },
        });
        if (taken >= event.maxRegistrations) {
          throw new RegistrationCapacityError();
        }
      }

      // Allocate the human-readable registration number atomically: the
      // per-event counter is incremented and read INSIDE this transaction, so
      // concurrent submits get distinct ordinals — and a rolled-back submit
      // (capacity 409 / idempotency race) releases its number with the txn.
      const counter = await tx.event.update({
        where: { id: event.id },
        data: { registrationSeq: { increment: 1 } },
        select: { registrationSeq: true, numberPrefix: true },
      });
      // Registrant ordinal padded to 4 digits (supports up to 9999/event; a
      // rare overflow past 9999 still works, the number just grows by a digit).
      const registrationNumber = counter.numberPrefix
        ? `${counter.numberPrefix}${String(counter.registrationSeq).padStart(4, "0")}`
        : null;

      const registration = await tx.registration.create({
        data: {
          eventId: event.id,
          centerId: center.id,
          arrivalDateId: input.arrivalDateId,
          arrivalTime: input.arrivalTime,
          departureDateId: input.departureDateId,
          earlyDeparture: input.earlyDeparture,
          hasAccommodation: input.hasAccommodation,
          email: input.email,
          gdprConsent: input.gdprConsent,
          totalPrice: pricing.totalPrice,
          status: "REGISTERED",
          idempotencyKey: input.idempotencyKey,
          ipAddress: meta.ipAddress,
          // Persist the visitor's UI locale so a later admin resend emails in
          // their original language (P6), not a cs default.
          locale: meta.lang,
          registrationNumber,
        },
      });

      for (const [i, p] of participantsInput.entries()) {
        const priced = pricing.participants[i];
        const participant = await tx.participant.create({
          data: {
            registrationId: registration.id,
            fullName: p.fullName,
            ageCategory: p.ageCategory,
            // pricingType only applies to 15+ (invariant 15); the column is
            // non-nullable so children keep the STANDARD default.
            pricingType: p.ageCategory === "AGE_15_PLUS" ? (p.pricingType ?? "STANDARD") : "STANDARD",
            mealType: p.mealType,
            participationPrice: priced?.participationPrice ?? 0,
            mealPrice: priced?.mealPrice ?? 0,
            totalPrice: priced?.subtotal ?? 0,
            sortOrder: i,
          },
        });

        const selectedMeals = [...new Set(p.mealIds)]
          .map((id) => mealById.get(id))
          .filter((m): m is NonNullable<typeof m> => m !== undefined && !m.isClosed);
        if (selectedMeals.length > 0) {
          await tx.participantMeal.createMany({
            data: selectedMeals.map((m) => ({
              participantId: participant.id,
              eventMealId: m.id,
              // Snapshot of the meal's price at registration time (factual
              // data, not computed pricing — the P5 engine works on top).
              price: m.price,
            })),
          });
        }
      }

      return { id: registration.id, registrationNumber };
    });
    registrationId = result.id;
    registrationNumber = result.registrationNumber;
  } catch (err) {
    // Two same-key submits can race past the findUnique above; the @unique on
    // idempotencyKey makes the loser fail with P2002 — return the winner's row.
    if (isUniqueViolation(err)) {
      const winner = await prisma.registration.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (winner) {
        return { registrationId: winner.id, confirmationSent: winner.confirmationSentAt !== null };
      }
    }
    throw err;
  }

  // ─── Confirmation email — AFTER commit, non-blocking (invariant 6) ──────────
  const lang = meta.lang;
  const emailData = buildConfirmationEmailData(
    {
      registrationNumber,
      to: input.email,
      event,
      center,
      arrivalDate,
      arrivalTime: input.arrivalTime,
      departureDate,
      earlyDeparture: input.earlyDeparture,
      hasAccommodation: input.hasAccommodation,
      totalPrice: pricing.totalPrice,
      participants: participantsInput.map((p, i) => ({
        fullName: p.fullName,
        ageCategory: p.ageCategory,
        pricingType: p.ageCategory === "AGE_15_PLUS" ? (p.pricingType ?? "STANDARD") : null,
        mealType: p.mealType,
        subtotal: pricing.participants[i]?.subtotal ?? 0,
        meals: [...new Set(p.mealIds)]
          .map((id) => mealById.get(id))
          .filter((m): m is NonNullable<typeof m> => m !== undefined && !m.isClosed)
          .map((m) => ({ label_cs: m.label_cs, label_en: m.label_en })),
      })),
    },
    lang,
  );

  const email = await sendRegistrationConfirmation(emailData, lang);
  if (email.sent) {
    // confirmationSentAt only on success — a failed send leaves it null so a
    // later manual resend (P6) can find it.
    await prisma.registration.update({
      where: { id: registrationId },
      data: { confirmationSentAt: new Date() },
    });
  } else if (email.error) {
    console.error(`[registrations] confirmation email failed for ${registrationId}: ${email.error}`);
  }

  return { registrationId, confirmationSent: email.sent };
}

// Duck-typed P2002 check — avoids importing generated-client error classes.
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

// ─── DRY confirmation-email assembly (shared by submit + admin resend) ─────────
// A language-agnostic source shape both callers build (submit from the request +
// pricing seam; resend from DB rows). The builder localizes it into the email's
// ConfirmationEmailData. Keeps the two call sites from drifting (P1 audit valued
// single-source assembly).
type ConfirmationSource = {
  registrationNumber: string | null;
  to: string;
  event: {
    title_cs: string;
    title_en: string;
    startDate: Date;
    endDate: Date;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
  };
  center: { name_cs: string; name_en: string }; // registrant's HOME centre
  arrivalDate: { label_cs: string; label_en: string };
  arrivalTime: string;
  departureDate: { label_cs: string; label_en: string };
  earlyDeparture: string;
  hasAccommodation: boolean;
  totalPrice: number;
  participants: Array<{
    fullName: string;
    ageCategory: string;
    pricingType: string | null; // null → omitted (children, invariant 15)
    mealType: string; // MEAT | VEGETARIAN
    subtotal: number;
    meals: { label_cs: string; label_en: string }[];
  }>;
};

function buildConfirmationEmailData(
  src: ConfirmationSource,
  lang: "cs" | "en",
): ConfirmationEmailData {
  const pick = (cs: string, en: string) => (lang === "cs" ? cs : en);
  return {
    registrationNumber: src.registrationNumber,
    to: src.to,
    eventTitle: pick(src.event.title_cs, src.event.title_en),
    eventStart: src.event.startDate,
    eventEnd: src.event.endDate,
    contactName: src.event.contactName,
    contactPhone: src.event.contactPhone,
    contactEmail: src.event.contactEmail,
    arrivalLabel: pick(src.arrivalDate.label_cs, src.arrivalDate.label_en),
    arrivalTime: src.arrivalTime,
    departureLabel: pick(src.departureDate.label_cs, src.departureDate.label_en),
    earlyDeparture: src.earlyDeparture,
    hasAccommodation: src.hasAccommodation,
    centerName: pick(src.center.name_cs, src.center.name_en),
    participants: src.participants.map((p) => ({
      fullName: p.fullName,
      ageCategory: p.ageCategory,
      pricingType: p.pricingType ?? undefined,
      mealType: p.mealType,
      meals: p.meals.map((m) => pick(m.label_cs, m.label_en)),
      subtotal: p.subtotal,
    })),
    totalPrice: src.totalPrice,
  };
}

// ─── Admin reads / writes (ownership — invariant 20) ──────────────────────────
// A registration is visible/editable iff its event's centre is one of the admin's
// assigned centres (ADMIN) or always (SUPER_ADMIN) — scope is by centre, not by
// who created the event. The centre shown/filtered in the LIST is the
// event's hosting centre (decision 12); the registrant's own home centre is a
// separate, editable field surfaced in the detail.

export type AdminRegistrationStatus = "REGISTERED" | "CANCELLED" | "PAID";

export type AdminRegistrationListItem = {
  id: string;
  registrationNumber: string | null;
  email: string;
  status: AdminRegistrationStatus;
  totalPrice: number;
  createdAt: string; // UTC ISO
  participantCount: number;
  eventId: string;
  eventTitle_cs: string;
  eventTitle_en: string;
  centerId: string; // event's hosting centre id
  centerName_cs: string;
  centerName_en: string;
};

export type AdminRegistrationDetailParticipant = {
  fullName: string;
  ageCategory: string;
  pricingType: string | null;
  mealType: string; // MEAT | VEGETARIAN
  totalPrice: number;
  meals: { label_cs: string; label_en: string; mealType: string }[];
};

export type AdminRegistrationDetailDTO = {
  id: string;
  registrationNumber: string | null;
  email: string;
  centerId: string; // registrant's HOME centre (editable)
  hasAccommodation: boolean;
  status: AdminRegistrationStatus;
  arrivalLabel_cs: string;
  arrivalLabel_en: string;
  arrivalTime: string;
  departureLabel_cs: string;
  departureLabel_en: string;
  earlyDeparture: string;
  event: {
    id: string;
    title_cs: string;
    title_en: string;
    centerName_cs: string;
    centerName_en: string;
  };
  // The event's meal slots + pricing rules, so the admin detail can show the same
  // "Informace o cenách" popup as the public event page (price-list check).
  eventMeals: EventMealDTO[];
  eventPricingRules: PricingRuleDTO[];
  participants: AdminRegistrationDetailParticipant[];
};

export type DayMealStat = {
  dateId: string;
  label_cs: string;
  label_en: string;
  // count = total portions; meat + vege split by each booker's diet choice.
  meals: { mealType: string; count: number; meat: number; vege: number }[];
};

// Centre/role filter fragment shared by the admin reads. ADMIN is scoped to the
// events of their assigned centres (invariant 20); SUPER_ADMIN: no filter.
function ownEventFilter(ctx: AdminContext) {
  return ctx.role === "ADMIN" ? { centerId: { in: ctx.centerIds } } : {};
}

export async function listRegistrations(
  ctx: AdminContext,
): Promise<AdminRegistrationListItem[]> {
  const rows = await prisma.registration.findMany({
    where: { deletedAt: null, event: { deletedAt: null, ...ownEventFilter(ctx) } },
    include: {
      event: { include: { center: true } },
      _count: { select: { participants: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    registrationNumber: r.registrationNumber,
    email: r.email,
    status: r.status,
    totalPrice: r.totalPrice,
    createdAt: r.createdAt.toISOString(),
    participantCount: r._count.participants,
    eventId: r.eventId,
    eventTitle_cs: r.event.title_cs,
    eventTitle_en: r.event.title_en,
    centerId: r.event.centerId,
    centerName_cs: r.event.center.name_cs,
    centerName_en: r.event.center.name_en,
  }));
}

export async function getRegistrationForDetail(
  id: string,
  ctx: AdminContext,
): Promise<AdminRegistrationDetailDTO | null> {
  const r = await prisma.registration.findFirst({
    where: { id, deletedAt: null, event: { ...ownEventFilter(ctx) } },
    include: {
      event: { include: { center: true, meals: true, pricingRules: true } },
      arrivalDate: true,
      departureDate: true,
      participants: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: { meals: { include: { eventMeal: true } } },
      },
    },
  });
  if (!r) return null;

  return {
    id: r.id,
    registrationNumber: r.registrationNumber,
    email: r.email,
    centerId: r.centerId,
    hasAccommodation: r.hasAccommodation,
    status: r.status,
    arrivalLabel_cs: r.arrivalDate.label_cs,
    arrivalLabel_en: r.arrivalDate.label_en,
    arrivalTime: r.arrivalTime,
    departureLabel_cs: r.departureDate.label_cs,
    departureLabel_en: r.departureDate.label_en,
    earlyDeparture: r.earlyDeparture,
    event: {
      id: r.event.id,
      title_cs: r.event.title_cs,
      title_en: r.event.title_en,
      centerName_cs: r.event.center.name_cs,
      centerName_en: r.event.center.name_en,
    },
    eventMeals: r.event.meals.map((m) => ({
      id: m.id,
      eventDateId: m.eventDateId,
      mealType: m.mealType,
      price: m.price,
      isClosed: m.isClosed,
    })),
    eventPricingRules: r.event.pricingRules.map((pr) => ({
      id: pr.id,
      ageCategory: pr.ageCategory,
      pricingType: pr.pricingType,
      dailyRate: pr.dailyRate,
      nightRate: pr.nightRate,
      morningArrivalDiscount: pr.morningArrivalDiscount,
      afternoonArrivalDiscount: pr.afternoonArrivalDiscount,
      eveningArrivalDiscount: pr.eveningArrivalDiscount,
      earlyDepartureDiscount: pr.earlyDepartureDiscount,
    })),
    participants: r.participants.map((p) => ({
      fullName: p.fullName,
      ageCategory: p.ageCategory,
      pricingType: p.ageCategory === "AGE_15_PLUS" ? p.pricingType : null,
      mealType: p.mealType,
      totalPrice: p.totalPrice,
      meals: p.meals.map((pm) => ({
        label_cs: pm.eventMeal.label_cs,
        label_en: pm.eventMeal.label_en,
        mealType: pm.eventMeal.mealType,
      })),
    })),
  };
}

// Re-fetch + assert the caller may write this registration. Missing → 404;
// ADMIN-not-owner → 403. Returns the pre-image of the editable fields so the
// caller can record it as audit `oldData` (P4).
async function assertRegistrationWritable(id: string, ctx: AdminContext) {
  const r = await prisma.registration.findFirst({
    where: { id, deletedAt: null },
    select: {
      centerId: true,
      hasAccommodation: true,
      status: true,
      event: { select: { centerId: true } },
    },
  });
  if (!r) throw new RegistrationNotFoundError();
  if (ctx.role === "ADMIN" && !ctx.centerIds.includes(r.event.centerId)) {
    throw new RegistrationForbiddenError();
  }
  return r;
}

// Editable fields only (decision 2): home centre, accommodation, status. No
// price recompute — the P5 engine owns pricing; the stay days/meals are immutable.
export async function updateRegistration(
  id: string,
  input: RegistrationUpdateInput,
  ctx: AdminContext,
): Promise<{ id: string }> {
  const before = await assertRegistrationWritable(id, ctx);
  await prisma.registration.update({
    where: { id },
    data: {
      centerId: input.centerId,
      hasAccommodation: input.hasAccommodation,
      status: input.status,
    },
  });

  // One endpoint covers both spec actions: emit `registration.status_change`
  // when the lifecycle status flipped, else the generic `registration.update`.
  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: before.status !== input.status ? "registration.status_change" : "registration.update",
    entityType: "Registration",
    entityId: id,
    oldData: { centerId: before.centerId, hasAccommodation: before.hasAccommodation, status: before.status },
    newData: { centerId: input.centerId, hasAccommodation: input.hasAccommodation, status: input.status },
  });

  return { id };
}

// Re-send the confirmation email (production bilingual template — P6).
// Ownership-checked. Language = the registration's STORED `locale` (P6 — the
// visitor's original language), not a cs default. Sets confirmationSentAt on
// success; a failure (incl. Resend test-mode rejecting a non-owner recipient)
// is surfaced honestly, never thrown.
export async function resendConfirmation(
  id: string,
  ctx: AdminContext,
): Promise<{ confirmationSent: boolean; error?: string }> {
  const r = await prisma.registration.findFirst({
    where: { id, deletedAt: null },
    include: {
      event: true,
      center: true,
      arrivalDate: true,
      departureDate: true,
      participants: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: { meals: { include: { eventMeal: true } } },
      },
    },
  });
  if (!r) throw new RegistrationNotFoundError();
  if (ctx.role === "ADMIN" && !ctx.centerIds.includes(r.event.centerId)) {
    throw new RegistrationForbiddenError();
  }

  // The visitor's original language, defended against any unexpected stored value.
  const lang: "cs" | "en" = r.locale === "en" ? "en" : "cs";

  const emailData = buildConfirmationEmailData(
    {
      registrationNumber: r.registrationNumber,
      to: r.email,
      event: r.event,
      center: r.center,
      arrivalDate: r.arrivalDate,
      arrivalTime: r.arrivalTime,
      departureDate: r.departureDate,
      earlyDeparture: r.earlyDeparture,
      hasAccommodation: r.hasAccommodation,
      totalPrice: r.totalPrice,
      participants: r.participants.map((p) => ({
        fullName: p.fullName,
        ageCategory: p.ageCategory,
        pricingType: p.ageCategory === "AGE_15_PLUS" ? p.pricingType : null,
        mealType: p.mealType,
        subtotal: p.totalPrice,
        meals: p.meals.map((pm) => ({
          label_cs: pm.eventMeal.label_cs,
          label_en: pm.eventMeal.label_en,
        })),
      })),
    },
    lang,
  );

  const email = await sendRegistrationConfirmation(emailData, lang);
  if (email.sent) {
    await prisma.registration.update({
      where: { id },
      data: { confirmationSentAt: new Date() },
    });
  }

  // Record the manual resend attempt + its honest outcome (P4).
  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "email.resend",
    entityType: "Registration",
    entityId: id,
    newData: { confirmationSent: email.sent, lang, to: r.email },
  });

  return { confirmationSent: email.sent, error: email.error };
}

// Per-day meal counts for one event (the kitchen "how many to cook" panel),
// ownership-scoped. Counts ParticipantMeal rows of REGISTERED, non-deleted
// registrations against each open meal slot. Returns [] for a missing / not-owned
// event. DB equivalent of the former mock computeMealStats.
const MEAL_STAT_ORDER: Record<string, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 };

export async function getEventMealStats(
  eventId: string,
  ctx: AdminContext,
): Promise<DayMealStat[]> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, ...ownEventFilter(ctx) },
    select: { id: true },
  });
  if (!event) return [];

  const [dates, meals, participantMeals] = await Promise.all([
    prisma.eventDate.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" } }),
    prisma.eventMeal.findMany({ where: { eventId, isClosed: false } }),
    prisma.participantMeal.findMany({
      where: {
        eventMeal: { eventId },
        participant: {
          deletedAt: null,
          registration: { status: "REGISTERED", deletedAt: null },
        },
      },
      // The booker's diet drives the meat/vege split of each portion.
      select: { eventMealId: true, participant: { select: { mealType: true } } },
    }),
  ]);

  const statByMeal = new Map<string, { count: number; meat: number; vege: number }>();
  for (const pm of participantMeals) {
    const s = statByMeal.get(pm.eventMealId) ?? { count: 0, meat: 0, vege: 0 };
    s.count += 1;
    if (pm.participant.mealType === "VEGETARIAN") s.vege += 1;
    else s.meat += 1;
    statByMeal.set(pm.eventMealId, s);
  }

  const mealsByDate = new Map<string, typeof meals>();
  for (const m of meals) {
    const arr = mealsByDate.get(m.eventDateId) ?? [];
    arr.push(m);
    mealsByDate.set(m.eventDateId, arr);
  }

  const result: DayMealStat[] = [];
  for (const d of dates) {
    const dayMeals = (mealsByDate.get(d.id) ?? [])
      .map((m) => {
        const s = statByMeal.get(m.id) ?? { count: 0, meat: 0, vege: 0 };
        return { mealType: m.mealType as string, count: s.count, meat: s.meat, vege: s.vege };
      })
      .sort((a, b) => (MEAL_STAT_ORDER[a.mealType] ?? 0) - (MEAL_STAT_ORDER[b.mealType] ?? 0));
    if (dayMeals.length > 0) {
      result.push({ dateId: d.id, label_cs: d.label_cs, label_en: d.label_en, meals: dayMeals });
    }
  }
  return result;
}

// Per-night on-site accommodation headcount for one event (the "how many beds"
// panel), ownership-scoped. Accommodation is per-registration (all its
// participants sleep on site); a registration covers the nights of days
// [arrival.sortOrder, departure.sortOrder − 1]. The last event day is never a
// night. Counts REGISTERED, non-deleted registrations with hasAccommodation.
export type NightStat = {
  dateId: string;
  label_cs: string;
  label_en: string;
  count: number; // people sleeping on site that night
};

export async function getEventAccommodationStats(
  eventId: string,
  ctx: AdminContext,
): Promise<NightStat[]> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, ...ownEventFilter(ctx) },
    select: { id: true },
  });
  if (!event) return [];

  const [dates, regs] = await Promise.all([
    prisma.eventDate.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" } }),
    prisma.registration.findMany({
      where: { eventId, deletedAt: null, status: "REGISTERED", hasAccommodation: true },
      select: {
        arrivalDate: { select: { sortOrder: true } },
        departureDate: { select: { sortOrder: true } },
        _count: { select: { participants: true } },
      },
    }),
  ]);

  const result: NightStat[] = [];
  // Each day except the last is a night you can sleep through.
  for (let i = 0; i < dates.length - 1; i++) {
    const d = dates[i]!;
    let count = 0;
    for (const r of regs) {
      if (r.arrivalDate.sortOrder <= d.sortOrder && r.departureDate.sortOrder > d.sortOrder) {
        count += r._count.participants;
      }
    }
    result.push({ dateId: d.id, label_cs: d.label_cs, label_en: d.label_en, count });
  }
  return result;
}

// ─── Admin registration export (P7) ───────────────────────────────────────────
// Builds the flat row table for the CSV/XLSX export. Data query + row shaping
// live here (invariant 8); the route only serializes. Filters are re-applied
// server-side under the same ownership scope as the list (ownEventFilter), so a
// client can never export rows it couldn't already see. Labels are localized to
// `lang` via an inline cs/en map (the email module set this precedent —
// rendering happens outside the next-intl request scope; the values mirror the
// admin locale files).

type ExportLang = "cs" | "en";

export type RegistrationExportFilters = Omit<RegistrationExportInput, "format" | "lang">;

const EXPORT_HEADERS: Record<ExportLang, {
  regNo: string; event: string; created: string; email: string;
  eventCenter: string; homeCenter: string; status: string;
  arrival: string; arrivalTime: string; departure: string;
  earlyDeparture: string; accommodation: string; total: string; count: string;
  participant: string; pName: string; pAge: string; pType: string;
  pDiet: string;
  pParticipation: string; pMeal: string; pTotal: string; pMeals: string;
  yes: string; no: string; sheet: string;
}> = {
  cs: {
    regNo: "Č. registrace", event: "Akce", created: "Vytvořeno", email: "E-mail",
    eventCenter: "Centrum akce", homeCenter: "Domovské centrum", status: "Stav",
    arrival: "Příjezd", arrivalTime: "Čas příjezdu", departure: "Odjezd",
    earlyDeparture: "Dřívější odjezd", accommodation: "Ubytování",
    total: "Celková cena (Kč)", count: "Počet účastníků",
    participant: "Účastník", pName: "jméno", pAge: "věk", pType: "typ ceny",
    pDiet: "typ stravy",
    pParticipation: "cena za účast (Kč)", pMeal: "cena za stravu (Kč)",
    pTotal: "celkem (Kč)", pMeals: "strava",
    yes: "Ano", no: "Ne", sheet: "Registrace",
  },
  en: {
    regNo: "Reg. no.", event: "Event", created: "Created", email: "Email",
    eventCenter: "Event centre", homeCenter: "Home centre", status: "Status",
    arrival: "Arrival", arrivalTime: "Arrival time", departure: "Departure",
    earlyDeparture: "Early departure", accommodation: "Accommodation",
    total: "Total price (CZK)", count: "Participants",
    participant: "Participant", pName: "name", pAge: "age", pType: "price type",
    pDiet: "diet",
    pParticipation: "participation price (CZK)", pMeal: "meal price (CZK)",
    pTotal: "total (CZK)", pMeals: "meals",
    yes: "Yes", no: "No", sheet: "Registrations",
  },
};

const MEAL_CATEGORY_LABELS: Record<ExportLang, Record<string, string>> = {
  cs: { MEAT: "Masitá", VEGETARIAN: "Vegetariánská" },
  en: { MEAT: "Meat", VEGETARIAN: "Vegetarian" },
};

const REG_STATUS_LABELS: Record<ExportLang, Record<string, string>> = {
  cs: { REGISTERED: "Registrován/a", PAID: "Zaplaceno", CANCELLED: "Zrušeno" },
  en: { REGISTERED: "Registered", PAID: "Paid", CANCELLED: "Cancelled" },
};
const AGE_LABELS: Record<ExportLang, Record<string, string>> = {
  cs: { AGE_0_3: "0–3 roky", AGE_4_7: "4–7 let", AGE_8_14: "8–14 let", AGE_15_PLUS: "15 let a více" },
  en: { AGE_0_3: "0–3 years", AGE_4_7: "4–7 years", AGE_8_14: "8–14 years", AGE_15_PLUS: "15+ years" },
};
const PRICING_LABELS: Record<ExportLang, Record<string, string>> = {
  cs: { STANDARD: "Standardní", SUPPORTED: "Podporovaná", SURPLUS: "Nadbytek" },
  en: { STANDARD: "Standard", SUPPORTED: "Supported", SURPLUS: "Surplus" },
};
const ARRIVAL_TIME_LABELS: Record<ExportLang, Record<string, string>> = {
  cs: { MORNING: "Dopoledne", AFTERNOON: "Odpoledne", EVENING: "Večer" },
  en: { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" },
};

function formatExportDate(d: Date, lang: ExportLang): string {
  // Europe/Prague (invariant 11), regardless of server TZ.
  return new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(d);
}

export async function buildRegistrationExport(
  filters: RegistrationExportFilters,
  ctx: AdminContext,
  lang: ExportLang,
): Promise<ExportTable> {
  const search = filters.search?.trim();

  // Optional created-date range → UTC-day boundaries. The admin UI doesn't
  // surface a date filter yet; this honours the documented API contract. UTC-day
  // (not Prague-day) is a ≤2h boundary skew, immaterial for a coarse filter.
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (filters.dateFrom) createdAt.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) createdAt.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);

  const rows = await prisma.registration.findMany({
    where: {
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(createdAt.gte || createdAt.lte ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              { registrationNumber: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      event: {
        deletedAt: null,
        ...ownEventFilter(ctx),
        ...(filters.eventId ? { id: filters.eventId } : {}),
        ...(filters.centerId ? { centerId: filters.centerId } : {}),
      },
    },
    include: {
      event: { include: { center: true } },
      center: true, // registrant's HOME centre
      arrivalDate: true,
      departureDate: true,
      participants: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: { meals: { include: { eventMeal: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const L = EXPORT_HEADERS[lang];
  const pick = (cs: string, en: string) => (lang === "cs" ? cs : en);

  // Participant column-groups = the widest registration in the result (≥1 so the
  // file always carries the participant structure), capped at the 10-max (inv. 19).
  const maxParticipants = Math.min(
    10,
    Math.max(1, ...rows.map((r) => r.participants.length)),
  );

  const headers: string[] = [
    L.regNo, L.event, L.created, L.email, L.eventCenter, L.homeCenter, L.status,
    L.arrival, L.arrivalTime, L.departure, L.earlyDeparture, L.accommodation,
    L.total, L.count,
  ];
  for (let i = 1; i <= maxParticipants; i++) {
    headers.push(
      `${L.participant} ${i} — ${L.pName}`,
      `${L.participant} ${i} — ${L.pAge}`,
      `${L.participant} ${i} — ${L.pType}`,
      `${L.participant} ${i} — ${L.pDiet}`,
      `${L.participant} ${i} — ${L.pParticipation}`,
      `${L.participant} ${i} — ${L.pMeal}`,
      `${L.participant} ${i} — ${L.pTotal}`,
      `${L.participant} ${i} — ${L.pMeals}`,
    );
  }

  const dataRows: (string | number)[][] = rows.map((r) => {
    const row: (string | number)[] = [
      r.registrationNumber ?? "",
      pick(r.event.title_cs, r.event.title_en),
      formatExportDate(r.createdAt, lang),
      r.email,
      pick(r.event.center.name_cs, r.event.center.name_en),
      pick(r.center.name_cs, r.center.name_en),
      REG_STATUS_LABELS[lang][r.status] ?? r.status,
      pick(r.arrivalDate.label_cs, r.arrivalDate.label_en),
      ARRIVAL_TIME_LABELS[lang][r.arrivalTime] ?? r.arrivalTime,
      pick(r.departureDate.label_cs, r.departureDate.label_en),
      r.earlyDeparture === "AFTER_BREAKFAST" ? L.yes : L.no,
      r.hasAccommodation ? L.yes : L.no,
      r.totalPrice,
      r.participants.length,
    ];
    for (let i = 0; i < maxParticipants; i++) {
      const p = r.participants[i];
      if (!p) {
        row.push("", "", "", "", "", "", "", "");
        continue;
      }
      const is15 = p.ageCategory === "AGE_15_PLUS";
      row.push(
        p.fullName,
        AGE_LABELS[lang][p.ageCategory] ?? p.ageCategory,
        is15 ? (PRICING_LABELS[lang][p.pricingType] ?? p.pricingType) : "",
        MEAL_CATEGORY_LABELS[lang][p.mealType] ?? p.mealType,
        p.participationPrice,
        p.mealPrice,
        p.totalPrice,
        p.meals.map((pm) => pick(pm.eventMeal.label_cs, pm.eventMeal.label_en)).join(", "),
      );
    }
    return row;
  });

  return { headers, rows: dataRows, sheetName: L.sheet };
}
