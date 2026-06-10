// modules/registrations — the public registration submit (invariant 8: no fat
// route handlers). One idempotent transaction persists Registration +
// Participant + ParticipantMeal rows with server-recomputed prices (via the
// modules/pricing seam — zeros until P5, invariants 3–4), then sends the
// confirmation email OUTSIDE the transaction (invariant 6: email failure is
// non-blocking and never rolls anything back).

import { prisma } from "@/lib/db";
import { calculatePricing } from "@/modules/pricing";
import { isPubliclyVisible } from "@/modules/events";
import { sendRegistrationConfirmation, type ConfirmationEmailData } from "@/lib/email";
import type { RegistrationSubmitInput } from "@/lib/validation";

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

// Client-sent ids that don't belong to the event (tampered payload) → 422.
export class RegistrationStayMismatchError extends Error {
  constructor(message = "Stay dates do not belong to this event") {
    super(message);
    this.name = "RegistrationStayMismatchError";
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

  // Server-authoritative recompute via the pricing seam (invariants 3–4). The
  // client sends no prices and none would be trusted. Zeros until P5.
  const pricing = calculatePricing({
    participants: input.participants.map((p) => ({
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
  try {
    registrationId = await prisma.$transaction(async (tx) => {
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
        },
      });

      for (const [i, p] of input.participants.entries()) {
        const priced = pricing.participants[i];
        const participant = await tx.participant.create({
          data: {
            registrationId: registration.id,
            fullName: p.fullName,
            ageCategory: p.ageCategory,
            // pricingType only applies to 15+ (invariant 15); the column is
            // non-nullable so children keep the STANDARD default.
            pricingType: p.ageCategory === "AGE_15_PLUS" ? (p.pricingType ?? "STANDARD") : "STANDARD",
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

      return registration.id;
    });
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
  const dateLabel = (d: { label_cs: string; label_en: string }) =>
    lang === "cs" ? d.label_cs : d.label_en;

  const emailData: ConfirmationEmailData = {
    registrationId,
    to: input.email,
    eventTitle: lang === "cs" ? event.title_cs : event.title_en,
    eventStart: event.startDate,
    eventEnd: event.endDate,
    contactName: event.contactName,
    contactPhone: event.contactPhone,
    contactEmail: event.contactEmail,
    arrivalLabel: dateLabel(arrivalDate),
    arrivalTime: input.arrivalTime,
    departureLabel: dateLabel(departureDate),
    earlyDeparture: input.earlyDeparture,
    hasAccommodation: input.hasAccommodation,
    centerName: lang === "cs" ? center.name_cs : center.name_en,
    participants: input.participants.map((p, i) => ({
      fullName: p.fullName,
      ageCategory: p.ageCategory,
      pricingType: p.ageCategory === "AGE_15_PLUS" ? (p.pricingType ?? "STANDARD") : undefined,
      meals: [...new Set(p.mealIds)]
        .map((id) => mealById.get(id))
        .filter((m): m is NonNullable<typeof m> => m !== undefined && !m.isClosed)
        .map((m) => (lang === "cs" ? m.label_cs : m.label_en)),
      subtotal: pricing.participants[i]?.subtotal ?? 0,
    })),
    totalPrice: pricing.totalPrice,
  };

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
