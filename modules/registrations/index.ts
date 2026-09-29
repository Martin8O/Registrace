// modules/registrations — the public registration submit (invariant 8: no fat
// route handlers). One idempotent transaction persists Registration +
// Participant + ParticipantMeal rows with server-recomputed prices (via the
// modules/pricing seam — zeros until P5, invariants 3–4), then sends the
// confirmation email OUTSIDE the transaction (invariant 6: email failure is
// non-blocking and never rolls anything back).

import { prisma } from "@/lib/db";
import { calculatePricing } from "@/modules/pricing";
import { resolveMealPrice, effectiveMealPricingType } from "@/lib/utils/mealPrice";
import { getAvailableMealIds } from "@/lib/utils/mealAvailability";
import { checkStayOrder, STAY_RULE_MESSAGES, type StayRuleViolation } from "@/lib/utils/stayRules";
import {
  isPubliclyVisible,
  type EventMealDTO,
  type MealPricingRuleDTO,
  type PricingRuleDTO,
} from "@/modules/events";
import { sendRegistrationConfirmation, type ConfirmationEmailData } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";
import type { AdminContext } from "@/modules/auth";
import type {
  RegistrationSubmitInput,
  RegistrationExportInput,
  RegistrationFullPreviewInput,
  RegistrationFullUpdateInput,
} from "@/lib/validation";
import type { Prisma } from "@/generated/prisma";
import type { ExportTable } from "@/lib/export/xlsx";

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

// A participant picked a pricing tier this event does not offer → 422 (M40).
// The payload is well-formed — the tier is a valid enum value — so this is a
// business-rule rejection like RegistrationCenterInvalidError, not a validation
// failure (P3 reserves 400 + Zod issues for those). Never reachable from the real
// form, which only ever offers the event's own tiers.
export class RegistrationPricingTypeUnavailableError extends Error {
  // Set by the admin full edit (M50) only, so its editor can point at the person
  // and the half; the submit and the narrow edit refuse without them, as before.
  readonly participantIndex?: number;
  readonly half?: "stay" | "meals";
  constructor(
    message = "Pricing tier not offered by this event",
    detail?: { participantIndex: number; half: "stay" | "meals" },
  ) {
    super(message);
    this.name = "RegistrationPricingTypeUnavailableError";
    this.participantIndex = detail?.participantIndex;
    this.half = detail?.half;
  }
}

// Resending the CONFIRMATION for a CANCELLED registration → 409. The template is
// headed "Potvrzení registrace" and prints an amount to pay, so sending it for a
// cancelled booking tells the guest the opposite of what is true — and it is the
// one mail they would believe over anything said on the phone. A cancellation is
// its own message, which this app does not send yet; until it does, the honest
// answer is to refuse rather than to confirm something that is off.
export class RegistrationCancelledError extends Error {
  constructor(message = "Registration is cancelled") {
    super(message);
    this.name = "RegistrationCancelledError";
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

// Admin edit sets a home centre that doesn't exist or is no longer active → 422.
// (Access scoping rides on event.centerId; this only keeps the informational
// Registration.centerId — used on the confirmation/export — from going stale.)
export class RegistrationCenterInvalidError extends Error {
  constructor(message = "Unknown or inactive center") {
    super(message);
    this.name = "RegistrationCenterInvalidError";
  }
}

export type SubmitMeta = {
  ipAddress: string | null; // stored for rate-limiting only (P4)
  lang: "cs" | "en"; // confirmation-email language
};

export type SubmitResult = {
  registrationId: string;
  // The human-readable number ("260090009") the registrant is told to quote —
  // the internal cuid means nothing to them. Null only where there is no row to
  // name: the honeypot's fake success, and legacy rows predating the numbering.
  registrationNumber: string | null;
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
    return { registrationId: HONEYPOT_SENTINEL, registrationNumber: null, confirmationSent: false };
  }

  // Idempotency (invariant 14): a replayed key returns the existing row, no
  // re-insert and no second email.
  const existing = await prisma.registration.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return {
      registrationId: existing.id,
      registrationNumber: existing.registrationNumber,
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
      mealPricingRules: true,
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
  // "after breakfast" departure requires a morning arrival. One shared definition
  // since M50 — the admin full edit enforces exactly the same three.
  const stayViolation = checkStayOrder({
    arrivalSortOrder: arrivalDate.sortOrder,
    departureSortOrder: departureDate.sortOrder,
    arrivalTime: input.arrivalTime,
    earlyDeparture: input.earlyDeparture,
  });
  if (stayViolation) {
    throw new RegistrationStayMismatchError(STAY_RULE_MESSAGES[stayViolation]);
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
    // The tier that prices THIS person's meals, resolved once here so the engine,
    // the stored participant row and every per-meal price snapshot cannot drift
    // apart. A payload that carries no meal tier predates M40, when one tier
    // priced both halves — so it falls back to that person's participation tier,
    // never to STANDARD (see lib/utils/mealPrice).
    mealPricingType: effectiveMealPricingType(p) ?? "STANDARD",
  }));

  // Both tiers must be ones this event actually offers (M40). Checked here rather
  // than in the Zod schema because only the service has the event loaded, and the
  // sets differ per event. A stale client on an event whose meal tiers were
  // narrowed is rejected rather than quietly re-priced to STANDARD — refusing the
  // registration is recoverable, charging the wrong price silently is not.
  //
  // An event with an EMPTY set offers all three, mirroring the empty-meal-price-
  // list rule (invariant 21): validation forbids an empty set, so one can only
  // come from a data anomaly, and "keep offering what every event has always
  // offered" is the answer that cannot turn a bad row into a wall of rejected
  // registrations.
  const offeredParticipation: string[] = event.participationPricingTypes ?? [];
  const offeredMeals: string[] = event.mealPricingTypes ?? [];
  for (const p of participantsInput) {
    const participationTier = p.pricingType ?? "STANDARD";
    if (offeredParticipation.length > 0 && !offeredParticipation.includes(participationTier)) {
      throw new RegistrationPricingTypeUnavailableError(
        `Participation tier ${participationTier} is not offered by this event`,
      );
    }
    if (offeredMeals.length > 0 && !offeredMeals.includes(p.mealPricingType)) {
      throw new RegistrationPricingTypeUnavailableError(
        `Meal tier ${p.mealPricingType} is not offered by this event`,
      );
    }
  }

  // Server-authoritative recompute via the pricing seam (invariants 3–4). The
  // client sends no prices and none would be trusted.
  const pricing = calculatePricing({
    participants: participantsInput.map((p) => ({
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealPricingType: p.mealPricingType,
      mealIds: p.mealIds,
    })),
    pricingRules: event.pricingRules,
    mealPricingRules: event.mealPricingRules,
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
      // Take a row lock on the Event FIRST, by doing the atomic counter
      // increment up front. Under READ COMMITTED two concurrent submits would
      // otherwise both run a non-locking count(), both see capacity-1, and both
      // insert → over-booking past maxRegistrations (security audit race
      // finding). Locking the Event row here serializes them at the gate, so the
      // count() below sees every prior committed insert. A rollback (capacity 409
      // / idempotency race) releases both the number AND the lock with the txn.
      const counter = await tx.event.update({
        where: { id: event.id },
        data: { registrationSeq: { increment: 1 } },
        select: { registrationSeq: true, numberPrefix: true },
      });

      // Capacity re-checked inside the transaction (now race-free, see above).
      // Only live registrations count — CANCELLED ones free their slot, matching
      // the meal/accommodation stats (which already exclude CANCELLED). Without
      // the status filter a cancelled registration would consume a seat forever.
      if (event.maxRegistrations !== null) {
        const taken = await tx.registration.count({
          where: {
            eventId: event.id,
            deletedAt: null,
            status: { in: ["REGISTERED", "PAID"] },
          },
        });
        if (taken >= event.maxRegistrations) {
          throw new RegistrationCapacityError();
        }
      }
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
            // The tier applies at every age since M37 (revised invariant 15), so a
            // child's chosen tier is persisted as-is instead of being flattened to
            // STANDARD. It is what the engine priced them at, and what the meal
            // price list is keyed by — storing anything else would make the stored
            // row disagree with the price charged.
            pricingType: p.pricingType ?? "STANDARD",
            // The second, independent tier (M40) — what this person's meals were
            // priced at. Stored alongside the participation tier so a later
            // re-price (the accommodation edit) reproduces the same meal prices.
            mealPricingType: p.mealPricingType,
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
              // Snapshot of what THIS participant was charged for this meal at
              // registration time — resolved through the same lookup the engine
              // used, so the row agrees with the participant's mealPrice and with
              // totalPrice. The flat EventMeal.price is now only one age/tier's
              // price, so storing it here would misstate every other one.
              price: resolveMealPrice(m.mealType, p, event.mealPricingRules, m.price),
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
        return {
          registrationId: winner.id,
          registrationNumber: winner.registrationNumber,
          confirmationSent: winner.confirmationSentAt !== null,
        };
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
        // Both tiers, shown for every age now that children have tiers too
        // (invariants 15 + 22) — and shown separately, because they are chosen
        // separately: surplus accommodation with supported meals is the case the
        // feature exists for, and one label cannot say that.
        pricingType: p.pricingType ?? "STANDARD",
        mealPricingType: p.mealPricingType,
        mealType: p.mealType,
        subtotal: pricing.participants[i]?.subtotal ?? 0,
        meals: [...new Set(p.mealIds)]
          .map((id) => mealById.get(id))
          .filter((m): m is NonNullable<typeof m> => m !== undefined && !m.isClosed)
          .flatMap((m) => {
            // A slot always belongs to a day of this event (the FK guarantees it,
            // and mealById is built from this event's own meals) — but the email
            // groups by day, so a slot without one would silently vanish from the
            // summary rather than be printed under a wrong heading.
            const day = dateById.get(m.eventDateId);
            if (!day) return [];
            return [{
              dayLabel_cs: day.label_cs,
              dayLabel_en: day.label_en,
              order: day.sortOrder,
              mealType: m.mealType,
            }];
          }),
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

  return { registrationId, registrationNumber, confirmationSent: email.sent };
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
    // BOTH tiers, at EVERY age (invariants 15 + 22). These used to be a single
    // tier blanked out under 15, back when tiers were a 15+ concept; the engine
    // never had that age branch, so the mail hid which tier produced the amount
    // it was printing — and a parent of a supported child read a dash.
    pricingType: string;
    mealPricingType: string;
    mealType: string; // MEAT | VEGETARIAN
    subtotal: number;
    // The ordered slots, structured: the email groups them by day, which it
    // cannot do from the pre-composed `EventMeal.label_*` ("Pátek 18.9. – večeře").
    // `order` is the event day's sortOrder — grouping keys on it, never on the
    // label, which is human text and not sortable.
    meals: { dayLabel_cs: string; dayLabel_en: string; order: number; mealType: string }[];
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
      pricingType: p.pricingType,
      mealPricingType: p.mealPricingType,
      mealType: p.mealType,
      meals: p.meals.map((m) => ({
        day: pick(m.dayLabel_cs, m.dayLabel_en),
        order: m.order,
        mealType: m.mealType,
      })),
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
  eventStatus: string; // event lifecycle — drives the "hide archived" list filter
  eventTitle_cs: string;
  eventTitle_en: string;
  centerId: string; // event's hosting centre id
  centerName_cs: string;
  centerName_en: string;
};

export type AdminRegistrationDetailParticipant = {
  // The Participant row id — the admin tier editor addresses each person by it.
  id: string;
  fullName: string;
  ageCategory: string;
  // The two independent tiers this person was priced on (invariant 22), both
  // shown at every age (invariant 15) — an admin reconciling an amount against
  // the price list needs to know which tier priced which half, and a child's
  // tier is as real as an adult's.
  pricingType: string;
  mealPricingType: string;
  mealType: string; // MEAT | VEGETARIAN
  participationPrice: number;
  mealPrice: number;
  totalPrice: number;
  // The ordered meal slots by id — what the full editor (M50b) ticks.
  mealIds: string[];
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
  eventMealPricingRules: MealPricingRuleDTO[];
  // The event's two offered-tier sets, so that popup filters each of its tables by
  // the same set the public page does (invariant 22) instead of quoting tiers this
  // event never offered.
  eventParticipationPricingTypes: string[];
  eventMealPricingTypes: string[];
  // What the full editor (M50b) needs to show the stay and the meal grid exactly as
  // the registrant chose them: the day ids, the event's days, the meal cut-off
  // (UTC ISO; the admin may book past it, the editor says so), the stored total,
  // and the row's updatedAt — the token the save is guarded by.
  arrivalDateId: string;
  departureDateId: string;
  eventDates: { id: string; date: string; label_cs: string; label_en: string; sortOrder: number }[];
  eventMealDeadline: string | null;
  totalPrice: number;
  updatedAt: string;
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
      // Live people only: a participant removed by the full edit (M50) is soft-
      // deleted, and must stop counting the moment they are removed.
      _count: { select: { participants: { where: { deletedAt: null } } } },
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
    eventStatus: r.event.status,
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
      event: {
        include: {
          center: true,
          meals: true,
          pricingRules: true,
          mealPricingRules: true,
          dates: { orderBy: { sortOrder: "asc" } },
        },
      },
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
    eventMealPricingRules: r.event.mealPricingRules.map((mr) => ({
      id: mr.id,
      mealType: mr.mealType,
      ageCategory: mr.ageCategory,
      pricingType: mr.pricingType,
      price: mr.price,
    })),
    eventParticipationPricingTypes: r.event.participationPricingTypes,
    eventMealPricingTypes: r.event.mealPricingTypes,
    arrivalDateId: r.arrivalDateId,
    departureDateId: r.departureDateId,
    eventDates: r.event.dates.map((d) => ({
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      label_cs: d.label_cs,
      label_en: d.label_en,
      sortOrder: d.sortOrder,
    })),
    eventMealDeadline: r.event.mealRegistrationDeadline?.toISOString() ?? null,
    totalPrice: r.totalPrice,
    updatedAt: r.updatedAt.toISOString(),
    participants: r.participants.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealPricingType: p.mealPricingType,
      mealType: p.mealType,
      participationPrice: p.participationPrice,
      mealPrice: p.mealPrice,
      totalPrice: p.totalPrice,
      mealIds: p.meals.map((pm) => pm.eventMealId),
      meals: p.meals.map((pm) => ({
        label_cs: pm.eventMeal.label_cs,
        label_en: pm.eventMeal.label_en,
        mealType: pm.eventMeal.mealType,
      })),
    })),
  };
}

// Thrown when an admin edit names a participant that is not a live participant of
// this registration. Handlers map it to HTTP 422. Silently ignoring the row is the
// wrong answer: the admin would be told their change was saved when it was not.
export class RegistrationParticipantMismatchError extends Error {
  constructor(message = "Participant does not belong to this registration") {
    super(message);
    this.name = "RegistrationParticipantMismatchError";
  }
}

// The re-snapshot writes, collapsed to one statement per distinct price. Order is
// irrelevant (each row is written exactly once, and the map keys are disjoint).
function groupMealSnapshotsByPrice(
  participants: ReadonlyArray<{ mealSnapshots: ReadonlyArray<{ id: string; price: number }> }>,
): Map<number, string[]> {
  const byPrice = new Map<number, string[]>();
  for (const p of participants) {
    for (const m of p.mealSnapshots) {
      const ids = byPrice.get(m.price);
      if (ids) ids.push(m.id);
      else byPrice.set(m.price, [m.id]);
    }
  }
  return byPrice;
}

// ─── Admin FULL registration edit (M50) ───────────────────────────────────────
// The registration team fixes a booking on site — a family registered, one of them
// did not come; someone leaves a day early; a child was booked as an adult — and
// collects the price the changed booking actually costs. Everything the registrant
// chose is editable except their e-mail (Martin, 2026-09-28). It replaced the
// narrower edit (status, centre, accommodation, tiers — M39/M40c), removed in M50d.
//
// ONE preparation function feeds both the live price preview and the save, so the
// number the admin sees while clicking and the number written can never disagree.

// The stay the admin chose breaks a stay rule, or names a day of another event
// → 422 `stay_invalid`. (The public submit answers the same rules with 400,
// because there only a tampered payload can reach them; here the admin's own
// editor is the caller, and the reason is what it shows.)
export class RegistrationStayInvalidError extends Error {
  readonly reason: StayRuleViolation | "day_unknown";
  constructor(reason: StayRuleViolation | "day_unknown") {
    super(reason === "day_unknown" ? "Stay day does not belong to this event" : STAY_RULE_MESSAGES[reason]);
    this.name = "RegistrationStayInvalidError";
    this.reason = reason;
  }
}

// A meal the admin ticked cannot be booked for this person → 422 with its code:
// not a meal of this event; a slot the event closed for that day (never served —
// Martin, 2026-09-28); or a slot outside the person's stay. The public submit
// never checked the last one server-side — only its form hid those meals — and an
// admin moving an arrival one day later is exactly the edit that would otherwise
// keep charging the meals of a day the person is not there.
//
// It names the person (their index in the editor's list) and the meal, so the
// editor can mark the exact box instead of answering every save with a refusal
// nobody can act on.
export type MealInvalidCode = "meal_unknown" | "meal_closed" | "meal_outside_stay";
export class RegistrationMealInvalidError extends Error {
  readonly code: MealInvalidCode;
  readonly participantIndex: number;
  readonly mealId: string;
  constructor(code: MealInvalidCode, participantIndex: number, mealId: string) {
    super(`Meal refused: ${code}`);
    this.name = "RegistrationMealInvalidError";
    this.code = code;
    this.participantIndex = participantIndex;
    this.mealId = mealId;
  }
}

// Someone saved this registration after the editor loaded it → 409. Writing
// anyway would silently overwrite their edit with a state built on the old one.
export class RegistrationChangedError extends Error {
  constructor(message = "Registration was changed by someone else") {
    super(message);
    this.name = "RegistrationChangedError";
  }
}

// Re-activating a CANCELLED registration takes a slot again, so it must pass the
// same capacity gate a new registration passes (submitRegistration). Locks the
// Event row first — the lock submit takes by bumping its counter — so a re-
// activation and a new registration racing for the last slot are serialized, and
// registrationSeq (the registration numbers) is not touched. No-op for an event
// without a limit (the common case: an empty maxRegistrations means unlimited).
async function assertCapacityForReactivation(
  tx: Prisma.TransactionClient,
  eventId: string,
  maxRegistrations: number | null | undefined,
  registrationId: string,
): Promise<void> {
  if (maxRegistrations == null) return;
  await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  const taken = await tx.registration.count({
    where: {
      eventId,
      deletedAt: null,
      status: { in: ["REGISTERED", "PAID"] },
      id: { not: registrationId },
    },
  });
  if (taken >= maxRegistrations) throw new RegistrationCapacityError();
}

// Everything a full edit needs, in one read. The event is reached through the
// registration — never through public visibility, because the registrations that
// most need fixing belong to events that are running or already over. A soft-
// deleted event reads as missing.
async function loadRegistrationForFullEdit(id: string) {
  return prisma.registration.findFirst({
    where: { id, deletedAt: null, event: { deletedAt: null } },
    select: {
      id: true,
      status: true,
      centerId: true,
      hasAccommodation: true,
      arrivalDateId: true,
      arrivalTime: true,
      departureDateId: true,
      earlyDeparture: true,
      totalPrice: true,
      event: {
        select: {
          id: true,
          centerId: true,
          maxRegistrations: true,
          mealRegistrationDeadline: true,
          participationPricingTypes: true,
          mealPricingTypes: true,
          dates: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, date: true, sortOrder: true, label_cs: true, label_en: true },
          },
          meals: {
            select: { id: true, eventDateId: true, mealType: true, price: true, isClosed: true },
          },
          pricingRules: true,
          mealPricingRules: true,
        },
      },
      participants: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          fullName: true,
          ageCategory: true,
          pricingType: true,
          mealPricingType: true,
          mealType: true,
          participationPrice: true,
          mealPrice: true,
          totalPrice: true,
          sortOrder: true,
          meals: { select: { id: true, eventMealId: true, price: true } },
        },
      },
    },
  });
}

type FullEditStored = NonNullable<Awaited<ReturnType<typeof loadRegistrationForFullEdit>>>;

type FullEditParticipantPlan = {
  input: RegistrationFullPreviewInput["participants"][number];
  current: FullEditStored["participants"][number] | undefined;
  participationPrice: number;
  mealPrice: number;
  totalPrice: number;
  // Every meal this person keeps or gets, each priced for them at their MEAL tier.
  meals: { eventMealId: string; price: number }[];
};

type FullEditPlan = {
  stored: FullEditStored;
  participants: FullEditParticipantPlan[];
  removed: FullEditStored["participants"];
  totalPrice: number;
  mealDeadlinePassed: boolean;
};

async function prepareFullUpdate(
  id: string,
  input: RegistrationFullPreviewInput,
  ctx: AdminContext,
): Promise<FullEditPlan> {
  const stored = await loadRegistrationForFullEdit(id);
  if (!stored) throw new RegistrationNotFoundError();
  if (ctx.role === "ADMIN" && !ctx.centerIds.includes(stored.event.centerId)) {
    throw new RegistrationForbiddenError();
  }
  const ev = stored.event;

  // Home centre: a CHANGED one must exist and be active. The stored one is a fact
  // to keep, not a request to approve — re-checking it would make every save of a
  // registration whose centre was later deactivated fail, however unrelated.
  if (input.centerId !== stored.centerId) {
    const center = await prisma.center.findFirst({
      where: { id: input.centerId, isActive: true },
      select: { id: true },
    });
    if (!center) throw new RegistrationCenterInvalidError();
  }

  // Stay: both days of THIS event, in an order the shared rules accept.
  const dateById = new Map(ev.dates.map((d) => [d.id, d]));
  const arrival = dateById.get(input.arrivalDateId);
  const departure = dateById.get(input.departureDateId);
  if (!arrival || !departure) throw new RegistrationStayInvalidError("day_unknown");
  const violation = checkStayOrder({
    arrivalSortOrder: arrival.sortOrder,
    departureSortOrder: departure.sortOrder,
    arrivalTime: input.arrivalTime,
    earlyDeparture: input.earlyDeparture,
  });
  if (violation) throw new RegistrationStayInvalidError(violation);

  // Participants: an id must be a live participant of THIS registration; one the
  // list no longer carries is being removed.
  const storedById = new Map(stored.participants.map((p) => [p.id, p]));
  for (const p of input.participants) {
    if (p.id !== undefined && !storedById.has(p.id)) throw new RegistrationParticipantMismatchError();
  }
  const keptIds = new Set(input.participants.flatMap((p) => (p.id ? [p.id] : [])));
  const removed = stored.participants.filter((p) => !keptIds.has(p.id));

  // Tiers: each checked against the event's OWN set for its half (invariant 22).
  // A tier an existing participant already holds is kept even if the event has
  // since stopped offering it (the "stranded tier" rule of M40c): otherwise a name
  // fix would fail on a tier nobody touched. A new person, or a tier that moved, must be one the event offers.
  const allows = (set: string[], tier: string) => set.length === 0 || set.includes(tier);
  for (const [participantIndex, p] of input.participants.entries()) {
    const current = p.id ? storedById.get(p.id) : undefined;
    if (current?.pricingType !== p.pricingType && !allows(ev.participationPricingTypes, p.pricingType)) {
      throw new RegistrationPricingTypeUnavailableError(
        `Participation tier ${p.pricingType} is not offered by this event`,
        { participantIndex, half: "stay" },
      );
    }
    if (current?.mealPricingType !== p.mealPricingType && !allows(ev.mealPricingTypes, p.mealPricingType)) {
      throw new RegistrationPricingTypeUnavailableError(
        `Meal tier ${p.mealPricingType} is not offered by this event`,
        { participantIndex, half: "meals" },
      );
    }
  }

  // Meals: of this event, open, and inside the NEW stay. The meal deadline is
  // deliberately not a gate here (Martin, 2026-09-28): it closes the public form,
  // and the team adding a lunch on site after it is the point of this editor. The
  // flag goes back to the editor, which says so.
  const eventDates = ev.dates.map((d) => ({
    id: d.id,
    date: d.date.toISOString().slice(0, 10),
    sortOrder: d.sortOrder,
    label_cs: d.label_cs,
    label_en: d.label_en,
  }));
  const mealById = new Map(ev.meals.map((m) => [m.id, m]));
  const presentFor = getAvailableMealIds(
    {
      arrivalDateId: input.arrivalDateId,
      arrivalTime: input.arrivalTime,
      departureDateId: input.departureDateId,
      earlyDeparture: input.earlyDeparture,
    },
    eventDates,
    ev.meals,
  );
  for (const [i, p] of input.participants.entries()) {
    for (const mealId of p.mealIds) {
      const slot = mealById.get(mealId);
      if (!slot) throw new RegistrationMealInvalidError("meal_unknown", i, mealId);
      if (slot.isClosed) throw new RegistrationMealInvalidError("meal_closed", i, mealId);
      if (!presentFor.has(mealId)) throw new RegistrationMealInvalidError("meal_outside_stay", i, mealId);
    }
  }

  // The price, from the same engine as the public submit (invariants 3–4). Input
  // order = the editor's order; results are positional, so they are read back by
  // the same index below.
  const priced = calculatePricing({
    participants: input.participants.map((p) => ({
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealPricingType: p.mealPricingType,
      mealIds: p.mealIds,
    })),
    pricingRules: ev.pricingRules,
    mealPricingRules: ev.mealPricingRules,
    meals: ev.meals,
    eventDates,
    arrivalDateId: input.arrivalDateId,
    arrivalTime: input.arrivalTime,
    departureDateId: input.departureDateId,
    earlyDeparture: input.earlyDeparture,
    hasAccommodation: input.hasAccommodation,
  });

  const participants = input.participants.map((p, i) => ({
    input: p,
    current: p.id ? storedById.get(p.id) : undefined,
    participationPrice: priced.participants[i]?.participationPrice ?? 0,
    mealPrice: priced.participants[i]?.mealPrice ?? 0,
    totalPrice: priced.participants[i]?.subtotal ?? 0,
    meals: p.mealIds.map((mealId) => {
      const slot = mealById.get(mealId)!; // every id was checked above
      return {
        eventMealId: mealId,
        // Through the same lookup the engine used, at the MEAL tier (invariant 21),
        // so each stored per-meal price agrees with the person's mealPrice.
        price: resolveMealPrice(
          slot.mealType,
          { ageCategory: p.ageCategory, mealPricingType: p.mealPricingType },
          ev.mealPricingRules,
          slot.price,
        ),
      };
    }),
  }));

  return {
    stored,
    participants,
    removed,
    totalPrice: priced.totalPrice,
    mealDeadlinePassed:
      ev.mealRegistrationDeadline !== null && Date.now() >= ev.mealRegistrationDeadline.getTime(),
  };
}

export type FullEditPreview = {
  totalPrice: number;
  // In the order the editor sent them; `id` null for a person being added.
  participants: { id: string | null; participationPrice: number; mealPrice: number; subtotal: number }[];
  mealDeadlinePassed: boolean;
};

// The live price while the admin clicks. Writes nothing. Refuses every combination
// the save would refuse, so the editor learns of a bad one before saving — all but
// the two that depend on the moment of saving: someone else saving in between, and
// a full event when un-cancelling. Those only the save can know.
export async function previewFullUpdate(
  id: string,
  input: RegistrationFullPreviewInput,
  ctx: AdminContext,
): Promise<FullEditPreview> {
  const plan = await prepareFullUpdate(id, input, ctx);
  return {
    totalPrice: plan.totalPrice,
    participants: plan.participants.map((p) => ({
      id: p.input.id ?? null,
      participationPrice: p.participationPrice,
      mealPrice: p.mealPrice,
      subtotal: p.totalPrice,
    })),
    mealDeadlinePassed: plan.mealDeadlinePassed,
  };
}

// The audit image of a registration: every field the full edit can move, and each
// participant with what they were charged and what they eat — enough to answer,
// months later, "why did this family's price change, and who changed it".
function fullEditAuditImage(
  reg: Pick<
    FullEditStored,
    "status" | "centerId" | "hasAccommodation" | "arrivalDateId" | "arrivalTime" | "departureDateId" | "earlyDeparture" | "totalPrice"
  >,
  participants: {
    id: string | null;
    fullName: string;
    ageCategory: string;
    pricingType: string;
    mealPricingType: string;
    mealType: string;
    totalPrice: number;
    mealIds: string[];
  }[],
) {
  return {
    status: reg.status,
    centerId: reg.centerId,
    hasAccommodation: reg.hasAccommodation,
    arrivalDateId: reg.arrivalDateId,
    arrivalTime: reg.arrivalTime,
    departureDateId: reg.departureDateId,
    earlyDeparture: reg.earlyDeparture,
    totalPrice: reg.totalPrice,
    participants,
  };
}

// An existing participant's row needs a write only when something on it moved.
function participantRowChanged(p: FullEditParticipantPlan): boolean {
  const c = p.current!;
  return (
    c.fullName !== p.input.fullName ||
    c.ageCategory !== p.input.ageCategory ||
    c.pricingType !== p.input.pricingType ||
    c.mealPricingType !== p.input.mealPricingType ||
    c.mealType !== p.input.mealType ||
    c.participationPrice !== p.participationPrice ||
    c.mealPrice !== p.mealPrice ||
    c.totalPrice !== p.totalPrice
  );
}

// The save. The number, the idempotency key, the locale, the e-mail and the
// confirmation timestamp are never written — they are not in the data below. No
// e-mail is sent (Martin, 2026-09-28): the admin resends the confirmation by hand
// when they want the registrant to have the new state.
export async function applyFullUpdate(
  id: string,
  input: RegistrationFullUpdateInput,
  ctx: AdminContext,
): Promise<{ id: string; totalPrice: number; updatedAt: string }> {
  const plan = await prepareFullUpdate(id, input, ctx);
  const { stored } = plan;
  const reactivating = stored.status === "CANCELLED" && input.status !== "CANCELLED";

  // Meal-row work, planned before the transaction so the transaction only writes.
  const mealRowsToDelete: string[] = [];
  const mealRowsToCreate: { participantId: string | null; index: number; eventMealId: string; price: number }[] = [];
  const mealRowsToReprice: { id: string; price: number }[] = [];
  plan.participants.forEach((p, index) => {
    const wanted = new Map(p.meals.map((m) => [m.eventMealId, m.price]));
    const have = new Map((p.current?.meals ?? []).map((m) => [m.eventMealId, m]));
    for (const [eventMealId, row] of have) {
      const price = wanted.get(eventMealId);
      if (price === undefined) mealRowsToDelete.push(row.id);
      else if (price !== row.price) mealRowsToReprice.push({ id: row.id, price });
    }
    for (const [eventMealId, price] of wanted) {
      if (!have.has(eventMealId)) {
        mealRowsToCreate.push({ participantId: p.current?.id ?? null, index, eventMealId, price });
      }
    }
  });

  let nextSortOrder = Math.max(-1, ...stored.participants.map((p) => p.sortOrder)) + 1;
  const createdIds = new Map<number, string>();
  // Written explicitly and handed back, so the editor can save again without
  // reloading: it holds the token the row now carries, not the one it opened with.
  const savedAt = new Date();
  const expected = new Date(input.expectedUpdatedAt);

  // One transaction. Timeout set explicitly: the function region and the database
  // are an ocean apart, so every statement is a long round trip; the plan above
  // keeps the count low (unchanged rows are not written, meal rows go in batches).
  await prisma.$transaction(
    async (tx) => {
      if (reactivating) {
        // The Event row is locked before the registration (the order the public
        // submit and the narrow edit take them in). Staleness is checked first all
        // the same: a registration someone else re-activated meanwhile must answer
        // "changed", not "event full" — the full event would be their doing.
        const stillAsLoaded = await tx.registration.count({ where: { id, updatedAt: expected } });
        if (stillAsLoaded === 0) throw new RegistrationChangedError();
        await assertCapacityForReactivation(tx, stored.event.id, stored.event.maxRegistrations, id);
      }

      // The concurrency guard IS the registration write: it matches only while the
      // row still carries the updatedAt the editor loaded. Nothing else is written
      // if it misses, and the throw rolls back the capacity lock with it.
      const guard = await tx.registration.updateMany({
        where: { id, deletedAt: null, updatedAt: expected },
        data: {
          updatedAt: savedAt,
          status: input.status,
          centerId: input.centerId,
          hasAccommodation: input.hasAccommodation,
          arrivalDateId: input.arrivalDateId,
          arrivalTime: input.arrivalTime,
          departureDateId: input.departureDateId,
          earlyDeparture: input.earlyDeparture,
          totalPrice: plan.totalPrice,
        },
      });
      if (guard.count === 0) throw new RegistrationChangedError();

      // Removed people are soft-deleted (invariant 9): gone from every count, list,
      // export and e-mail — all of which read `deletedAt: null` — but still there
      // for the audit trail, with the meals they had.
      if (plan.removed.length > 0) {
        await tx.participant.updateMany({
          where: { id: { in: plan.removed.map((p) => p.id) }, registrationId: id },
          data: { deletedAt: new Date() },
        });
      }

      for (const [index, p] of plan.participants.entries()) {
        const data = {
          fullName: p.input.fullName,
          ageCategory: p.input.ageCategory,
          // Both tiers in the same write as the prices they produced (invariant 22).
          pricingType: p.input.pricingType,
          mealPricingType: p.input.mealPricingType,
          mealType: p.input.mealType,
          participationPrice: p.participationPrice,
          mealPrice: p.mealPrice,
          totalPrice: p.totalPrice,
        };
        if (p.current) {
          if (participantRowChanged(p)) {
            await tx.participant.update({ where: { id: p.current.id }, data });
          }
        } else {
          const created = await tx.participant.create({
            data: { ...data, registrationId: id, sortOrder: nextSortOrder++ },
            select: { id: true },
          });
          createdIds.set(index, created.id);
        }
      }

      if (mealRowsToDelete.length > 0) {
        await tx.participantMeal.deleteMany({ where: { id: { in: mealRowsToDelete } } });
      }
      if (mealRowsToCreate.length > 0) {
        await tx.participantMeal.createMany({
          data: mealRowsToCreate.map((m) => ({
            participantId: m.participantId ?? createdIds.get(m.index)!,
            eventMealId: m.eventMealId,
            price: m.price,
          })),
        });
      }
      // A kept meal whose price moved (age or meal tier changed): one statement per
      // distinct price (a large booking row-at-a-time was dozens of round trips).
      for (const [price, ids] of groupMealSnapshotsByPrice([{ mealSnapshots: mealRowsToReprice }])) {
        await tx.participantMeal.updateMany({ where: { id: { in: ids } }, data: { price } });
      }
    },
    { maxWait: 5_000, timeout: 15_000 },
  );

  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "registration.full_update",
    entityType: "Registration",
    entityId: id,
    oldData: fullEditAuditImage(
      stored,
      stored.participants.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        ageCategory: p.ageCategory,
        pricingType: p.pricingType,
        mealPricingType: p.mealPricingType,
        mealType: p.mealType,
        totalPrice: p.totalPrice,
        mealIds: p.meals.map((m) => m.eventMealId),
      })),
    ),
    newData: fullEditAuditImage(
      { ...input, totalPrice: plan.totalPrice },
      plan.participants.map((p, index) => ({
        id: p.current?.id ?? createdIds.get(index) ?? null,
        fullName: p.input.fullName,
        ageCategory: p.input.ageCategory,
        pricingType: p.input.pricingType,
        mealPricingType: p.input.mealPricingType,
        mealType: p.input.mealType,
        totalPrice: p.totalPrice,
        mealIds: p.meals.map((m) => m.eventMealId),
      })),
    ),
  });

  return { id, totalPrice: plan.totalPrice, updatedAt: savedAt.toISOString() };
}

// Re-send the confirmation email (production bilingual template — P6).
// Ownership-checked, and refused outright for a CANCELLED registration. Language
// = the registration's STORED `locale` (P6 — the visitor's original language),
// not a cs default. Sets confirmationSentAt on
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
        // The slot's DAY as well as the slot: the confirmation groups meals by
        // day, so a resend that loaded only the meal would have to fall back to
        // the composed label and lose the grouping the first mail had.
        include: { meals: { include: { eventMeal: { include: { eventDate: true } } } } },
      },
    },
  });
  if (!r) throw new RegistrationNotFoundError();
  if (ctx.role === "ADMIN" && !ctx.centerIds.includes(r.event.centerId)) {
    throw new RegistrationForbiddenError();
  }
  // A cancelled registration is never re-confirmed. Refused BEFORE the send, so
  // no mail leaves and confirmationSentAt keeps pointing at the last confirmation
  // that was actually true. Deliberately not an "honest failure" like the Resend
  // test-mode rejection below — that one reports a send that was attempted and
  // failed, whereas this one must never be attempted at all.
  if (r.status === "CANCELLED") throw new RegistrationCancelledError();

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
        pricingType: p.pricingType,
        mealPricingType: p.mealPricingType,
        mealType: p.mealType,
        subtotal: p.totalPrice,
        meals: p.meals.map((pm) => ({
          dayLabel_cs: pm.eventMeal.eventDate.label_cs,
          dayLabel_en: pm.eventMeal.eventDate.label_en,
          order: pm.eventMeal.eventDate.sortOrder,
          mealType: pm.eventMeal.mealType,
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
// ownership-scoped. Counts ParticipantMeal rows of active (REGISTERED or PAID),
// non-deleted registrations against each open meal slot — only CANCELLED guests
// don't eat. Returns [] for a missing / not-owned event.
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
          registration: { status: { in: ["REGISTERED", "PAID"] }, deletedAt: null },
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
// night. Counts active (REGISTERED or PAID), non-deleted registrations with
// hasAccommodation — only CANCELLED guests free their bed.
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
      where: {
        eventId,
        deletedAt: null,
        status: { in: ["REGISTERED", "PAID"] },
        hasAccommodation: true,
      },
      select: {
        arrivalDate: { select: { sortOrder: true } },
        departureDate: { select: { sortOrder: true } },
        // Beds are for live people only — a removed participant (M50) frees theirs.
        _count: { select: { participants: { where: { deletedAt: null } } } },
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
  pMealType: string; pDiet: string;
  pParticipation: string; pMeal: string; pTotal: string; pMeals: string;
  yes: string; no: string; sheet: string;
}> = {
  cs: {
    regNo: "Č. registrace", event: "Akce", created: "Vytvořeno", email: "E-mail",
    eventCenter: "Centrum akce", homeCenter: "Domovské centrum", status: "Stav",
    arrival: "Příjezd", arrivalTime: "Čas příjezdu", departure: "Odjezd",
    earlyDeparture: "Dřívější odjezd", accommodation: "Ubytování",
    total: "Celková cena (Kč)", count: "Počet účastníků",
    participant: "Účastník", pName: "jméno", pAge: "věk",
    pType: "typ ceny za účast a noc", pMealType: "typ ceny za stravu",
    pDiet: "typ stravy",
    pParticipation: "cena za účast a noc (Kč)", pMeal: "cena za stravu (Kč)",
    pTotal: "celkem (Kč)", pMeals: "strava",
    yes: "Ano", no: "Ne", sheet: "Data – vše",
  },
  en: {
    regNo: "Reg. no.", event: "Event", created: "Created", email: "Email",
    eventCenter: "Event centre", homeCenter: "Home centre", status: "Status",
    arrival: "Arrival", arrivalTime: "Arrival time", departure: "Departure",
    earlyDeparture: "Early departure", accommodation: "Accommodation",
    total: "Total price (CZK)", count: "Participants",
    participant: "Participant", pName: "name", pAge: "age",
    pType: "participation and night price type", pMealType: "meal price type",
    pDiet: "diet",
    pParticipation: "participation and night price (CZK)", pMeal: "meal price (CZK)",
    pTotal: "total (CZK)", pMeals: "meals",
    yes: "Yes", no: "No", sheet: "Data – all",
  },
};

// Labels for the extra XLSX sheets (P7 follow-up): a trimmed quick-reference
// selection, plus the kitchen meal-prep and on-site accommodation tables. Sheet
// names stay ≤31 chars and free of Excel's reserved chars (: \ / ? * [ ]).
const EXPORT_SHEETS: Record<ExportLang, {
  all: string; selection: string; meals: string; accommodation: string;
  day: string; meal: string; total: string; meat: string;
  vege: string; night: string; people: string;
}> = {
  cs: {
    all: "Data – vše", selection: "Data – výběr", meals: "Jídlo", accommodation: "Ubytování",
    day: "Den", meal: "Jídlo", total: "Celkem", meat: "Masitá",
    vege: "Vegetariánská", night: "Noc", people: "Počet osob",
  },
  en: {
    all: "Data – all", selection: "Data – selection", meals: "Meals", accommodation: "Accommodation",
    day: "Day", meal: "Meal", total: "Total", meat: "Meat",
    vege: "Vegetarian", night: "Night", people: "People",
  },
};

const MEAL_TYPE_LABELS: Record<ExportLang, Record<string, string>> = {
  cs: { BREAKFAST: "Snídaně", LUNCH: "Oběd", DINNER: "Večeře" },
  en: { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner" },
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

// The registration WHERE used by both the export row query and the "which events
// are in scope" lookup (the meal-prep / accommodation sheets). One source of
// truth keeps the extra sheets aligned with the rows the admin is actually
// exporting, under the same ownership scope (ownEventFilter).
function exportRegistrationWhere(filters: RegistrationExportFilters, ctx: AdminContext) {
  const search = filters.search?.trim();

  // Optional created-date range → UTC-day boundaries. The admin UI doesn't
  // surface a date filter yet; this honours the documented API contract. UTC-day
  // (not Prague-day) is a ≤2h boundary skew, immaterial for a coarse filter.
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (filters.dateFrom) createdAt.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) createdAt.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);

  return {
    deletedAt: null,
    ...(filters.status ? { status: filters.status } : {}),
    ...(createdAt.gte || createdAt.lte ? { createdAt } : {}),
    ...(search
      ? {
          OR: [
            { registrationNumber: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    event: {
      deletedAt: null,
      ...(filters.eventId ? { id: filters.eventId } : {}),
      // Ownership scope AND any client-supplied centre filter must BOTH hold.
      // They are combined via `AND` (not spread onto one object) because both
      // ownEventFilter() and the client filter write the SAME `centerId` key —
      // spreading them let the later (body-controlled) value silently overwrite
      // the ownership key `{ in: ctx.centerIds }`, a cross-center IDOR: a scoped
      // ADMIN could export another centre's registrations (PII) just by sending
      // that centre's id. Under `AND` a foreign centerId simply yields 0 rows.
      // For a SUPER_ADMIN ownEventFilter() is {} so this reduces to the plain
      // client filter (SUPER_ADMIN may legitimately filter by any centre).
      AND: [
        ownEventFilter(ctx),
        ...(filters.centerId ? [{ centerId: filters.centerId }] : []),
      ],
    },
  };
}

// The sheet's column order, as NAMES rather than positions: first the
// registration-level columns, then one group per participant. The selection sheet
// below picks its columns out of these by name, so inserting a column here can no
// longer shift what that sheet shows (M41 finding N3 — the old hard-coded indices
// happened to still line up after M40c added a second tier column, and the
// export test would have caught it if they hadn't, but nothing in the code said
// WHICH columns the selection meant).
const REGISTRATION_COLUMN_KEYS = [
  "regNo", "created", "email", "eventCenter", "homeCenter", "status",
  "arrival", "arrivalTime", "departure", "earlyDeparture", "accommodation",
  "total", "count",
] as const;

const PARTICIPANT_COLUMN_KEYS = [
  "pName", "pAge", "pType", "pMealType", "pDiet",
  "pParticipation", "pMeal", "pTotal", "pMeals",
] as const;

type RegistrationColumnKey = (typeof REGISTRATION_COLUMN_KEYS)[number];
type ParticipantColumnKey = (typeof PARTICIPANT_COLUMN_KEYS)[number];

export async function buildRegistrationExport(
  filters: RegistrationExportFilters,
  ctx: AdminContext,
  lang: ExportLang,
): Promise<ExportTable> {
  const rows = await prisma.registration.findMany({
    where: exportRegistrationWhere(filters, ctx),
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

  // The event name is no longer a column — it's now the per-event sheet title (the
  // export is always scoped to a single event), set by buildRegistrationExportWorkbook.
  const headers: string[] = REGISTRATION_COLUMN_KEYS.map((k) => L[k]);
  for (let i = 1; i <= maxParticipants; i++) {
    for (const k of PARTICIPANT_COLUMN_KEYS) {
      headers.push(`${L.participant} ${i} — ${L[k]}`);
    }
  }

  const dataRows: (string | number)[][] = rows.map((r) => {
    // Keyed by the same names as the headers above, then emitted in that order —
    // so a column added to one and not the other is a type error, not a silently
    // shifted sheet.
    const regValues: Record<RegistrationColumnKey, string | number> = {
      regNo: r.registrationNumber ?? "",
      created: formatExportDate(r.createdAt, lang),
      email: r.email,
      eventCenter: pick(r.event.center.name_cs, r.event.center.name_en),
      homeCenter: pick(r.center.name_cs, r.center.name_en),
      status: REG_STATUS_LABELS[lang][r.status] ?? r.status,
      arrival: pick(r.arrivalDate.label_cs, r.arrivalDate.label_en),
      arrivalTime: ARRIVAL_TIME_LABELS[lang][r.arrivalTime] ?? r.arrivalTime,
      departure: pick(r.departureDate.label_cs, r.departureDate.label_en),
      earlyDeparture: r.earlyDeparture === "AFTER_BREAKFAST" ? L.yes : L.no,
      accommodation: r.hasAccommodation ? L.yes : L.no,
      total: r.totalPrice,
      count: r.participants.length,
    };
    const row: (string | number)[] = REGISTRATION_COLUMN_KEYS.map((k) => regValues[k]);
    for (let i = 0; i < maxParticipants; i++) {
      const p = r.participants[i];
      if (!p) {
        row.push(...PARTICIPANT_COLUMN_KEYS.map(() => ""));
        continue;
      }
      // Both tiers, for every age. The participation tier used to be blanked out
      // under 15 (the pre-M37 invariant 15, when tiers were 15+-only) — the engine
      // never had that branch, so the sheet was hiding the tier that produced the
      // amount in the column beside it, on a course that really does charge 8–14.
      const pValues: Record<ParticipantColumnKey, string | number> = {
        pName: p.fullName,
        pAge: AGE_LABELS[lang][p.ageCategory] ?? p.ageCategory,
        pType: PRICING_LABELS[lang][p.pricingType] ?? p.pricingType,
        pMealType: PRICING_LABELS[lang][p.mealPricingType] ?? p.mealPricingType,
        pDiet: MEAL_CATEGORY_LABELS[lang][p.mealType] ?? p.mealType,
        pParticipation: p.participationPrice,
        pMeal: p.mealPrice,
        pTotal: p.totalPrice,
        pMeals: p.meals
          .map((pm) => pick(pm.eventMeal.label_cs, pm.eventMeal.label_en))
          .join(", "),
      };
      for (const k of PARTICIPANT_COLUMN_KEYS) row.push(pValues[k]);
    }
    return row;
  });

  return { headers, rows: dataRows, sheetName: L.sheet };
}

// "Data – výběr": the on-site quick-reference columns the team asked for, sliced
// straight out of the full sheet (no extra query) so the two never drift. Named,
// not positional: the columns are looked up in REGISTRATION_COLUMN_KEYS, plus the
// FIRST participant's name — the first column of the first participant group,
// which begins where the registration-level columns end.
const SELECTION_COLUMN_KEYS = [
  "regNo", "status", "arrival", "arrivalTime", "departure",
  "earlyDeparture", "accommodation", "total", "count",
] as const satisfies readonly RegistrationColumnKey[];

const SELECTION_COLUMN_INDICES = [
  ...SELECTION_COLUMN_KEYS.map((k) => REGISTRATION_COLUMN_KEYS.indexOf(k)),
  REGISTRATION_COLUMN_KEYS.length + PARTICIPANT_COLUMN_KEYS.indexOf("pName"),
];

function buildSelectionSheet(main: ExportTable, lang: ExportLang): ExportTable {
  const headers = SELECTION_COLUMN_INDICES.map((i) => main.headers[i] ?? "");
  const rows = main.rows.map((r) => SELECTION_COLUMN_INDICES.map((i) => r[i] ?? ""));
  return { headers, rows, sheetName: EXPORT_SHEETS[lang].selection };
}

// "Jídlo" + "Ubytování": the kitchen meal-prep and on-site bed-count tables for the
// exported event. Reuses the same ownership-scoped aggregates the admin sees on the
// event's registrations page (getEventMealStats / getEventAccommodationStats), so
// the sheets match the on-screen panels — both now count active (REGISTERED + PAID)
// guests. The export is always scoped to one event; events without an eventId
// filter (none, in practice) simply yield empty kitchen sheets.
async function buildMealAndAccommodationSheets(
  eventId: string | undefined,
  ctx: AdminContext,
  lang: ExportLang,
): Promise<{ meals: ExportTable; accommodation: ExportTable }> {
  const S = EXPORT_SHEETS[lang];
  const pick = (cs: string, en: string) => (lang === "cs" ? cs : en);

  const [mealStats, nightStats] = eventId
    ? await Promise.all([
        getEventMealStats(eventId, ctx),
        getEventAccommodationStats(eventId, ctx),
      ])
    : [[], []];

  const mealRows: (string | number)[][] = [];
  for (const day of mealStats) {
    for (const m of day.meals) {
      mealRows.push([
        pick(day.label_cs, day.label_en),
        MEAL_TYPE_LABELS[lang][m.mealType] ?? m.mealType,
        m.count,
        m.meat,
        m.vege,
      ]);
    }
  }
  const accRows: (string | number)[][] = nightStats.map((n) => [
    pick(n.label_cs, n.label_en),
    n.count,
  ]);

  return {
    meals: {
      sheetName: S.meals,
      headers: [S.day, S.meal, S.total, S.meat, S.vege],
      rows: mealRows,
    },
    accommodation: {
      sheetName: S.accommodation,
      headers: [S.night, S.people],
      rows: accRows,
    },
  };
}

// The event's "Centre — Title" label, ownership-scoped, for the per-event sheet
// titles. Undefined if the event isn't found / not owned.
async function scopedEventLabel(
  eventId: string,
  ctx: AdminContext,
  lang: ExportLang,
): Promise<string | undefined> {
  const ev = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null, ...ownEventFilter(ctx) },
    select: {
      title_cs: true,
      title_en: true,
      center: { select: { name_cs: true, name_en: true } },
    },
  });
  if (!ev) return undefined;
  const pick = (cs: string, en: string) => (lang === "cs" ? cs : en);
  return `${pick(ev.center.name_cs, ev.center.name_en)} — ${pick(ev.title_cs, ev.title_en)}`;
}

// The full multi-sheet workbook for the (Excel-only) export, always scoped to one
// event: full data, the trimmed selection, and the kitchen meal-prep +
// accommodation tables. The event name is the title of every sheet.
export async function buildRegistrationExportWorkbook(
  filters: RegistrationExportFilters,
  ctx: AdminContext,
  lang: ExportLang,
): Promise<{ sheets: ExportTable[] }> {
  // Resolve the event FIRST. An eventId the admin may not see (or that does not
  // exist) used to fall through to a 200 with an empty workbook — no leak, since
  // every query is ownership-scoped, but it answered a question it should have
  // refused, and unlike the registration detail it did so with a file. Now it is
  // the same 404 that detail gives, and the expensive queries below never run.
  const title = filters.eventId
    ? await scopedEventLabel(filters.eventId, ctx, lang)
    : undefined;
  if (filters.eventId && !title) throw new RegistrationEventNotFoundError();

  const main = await buildRegistrationExport(filters, ctx, lang);
  const selection = buildSelectionSheet(main, lang);
  const { meals, accommodation } = await buildMealAndAccommodationSheets(
    filters.eventId,
    ctx,
    lang,
  );

  const sheets = [main, selection, meals, accommodation];
  for (const sheet of sheets) sheet.title = title;
  return { sheets };
}
