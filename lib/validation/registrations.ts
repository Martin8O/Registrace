import { z } from "zod";

// ─── Enum value tuples (mirror Prisma enums without importing from generated client) ───

const ageCategoryValues = ["AGE_0_3", "AGE_4_7", "AGE_8_14", "AGE_15_PLUS"] as const;
const pricingTypeValues = ["STANDARD", "SUPPORTED", "SURPLUS"] as const;
const arrivalTimeValues = ["MORNING", "AFTERNOON", "EVENING"] as const;
const earlyDepartureValues = ["NONE", "AFTER_BREAKFAST"] as const;
const mealCategoryValues = ["MEAT", "VEGETARIAN"] as const;

// ─── Participant schemas ──────────────────────────────────────────────────────

// String length caps (P8 item 7): every free-text/id input is bounded so a
// hostile client can't post multi-MB strings. IDs are cuid/uuid (~25–36 chars) →
// 64 is generous; names/emails use RFC-ish ceilings.
const calculateParticipantSchema = z.object({
  ageCategory: z.enum(ageCategoryValues),
  // Two independent tiers since M40: this one prices the stay/accommodation,
  // mealPricingType prices the meals. Both optional here and event-agnostic —
  // whether THIS event actually offers a given tier is checked in the submit
  // service, which is the only layer that has the event loaded. An absent meal
  // tier falls back to pricingType at that boundary (see lib/utils/mealPrice),
  // so a client written before M40 keeps being priced exactly as it is today.
  pricingType: z.enum(pricingTypeValues).optional(),
  mealPricingType: z.enum(pricingTypeValues).optional(),
  mealIds: z.array(z.string().min(1).max(64)).max(200),
});

const submitParticipantSchema = calculateParticipantSchema.extend({
  fullName: z.string().min(2).max(100),
  // Required diet choice ("musí si zvolit jedno") — meat or vegetarian. Price is
  // identical for both, so it stays out of the calculate-price schema.
  mealType: z.enum(mealCategoryValues),
});

// ─── Shared base fields ───────────────────────────────────────────────────────

const baseFields = {
  eventId: z.string().min(1).max(64),
  arrivalDateId: z.string().min(1).max(64),
  arrivalTime: z.enum(arrivalTimeValues),
  departureDateId: z.string().min(1).max(64),
  earlyDeparture: z.enum(earlyDepartureValues),
  hasAccommodation: z.boolean(),
  honeypot: z.string().max(200).optional(),
};

// ─── Shared refinements ───────────────────────────────────────────────────────

type RefineableBase = {
  honeypot?: string;
  participants: ReadonlyArray<{ ageCategory: string; pricingType?: string }>;
};

// The pricing tier used to be rejected for anyone under 15 here (old invariant 15).
// Since M37 the tier applies at EVERY age — an event can price a supported child
// differently from a standard one, for participation and for meals — so the tier is
// valid on any participant and the refinement is gone. Nothing is lost by dropping
// it: the tier is not a free-text field (the enum still bounds it), and the engine
// prices strictly from the event's own rules, so an unexpected combination resolves
// to that event's configured price rather than to anything the client chose.
function applySharedRefinements(data: RefineableBase, ctx: z.RefinementCtx): void {
  if (data.honeypot !== undefined && data.honeypot !== "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bot detected",
      path: ["honeypot"],
    });
  }
}

// ─── Public schemas ───────────────────────────────────────────────────────────

export const calculatePriceSchema = z
  .object({
    ...baseFields,
    participants: z.array(calculateParticipantSchema).min(1).max(10),
  })
  .superRefine((data, ctx) => applySharedRefinements(data, ctx));

export const registrationSubmitSchema = z
  .object({
    ...baseFields,
    idempotencyKey: z.string().uuid(),
    centerId: z.string().min(1).max(64),
    email: z.string().email().max(254), // RFC 5321 max address length
    // GDPR (P8 item 8): consent is a LITERAL true — a missing/false/`"true"`
    // value fails validation server-side, so a registration can never persist
    // without explicit affirmative consent. This is the authoritative gate
    // (the form checkbox is only the UI surface).
    gdprConsent: z.literal(true),
    participants: z.array(submitParticipantSchema).min(1).max(10),
  })
  // NOTE on the visitor's IP: it is NOT part of this schema. It is read
  // server-side from request headers (lib/security/rate-limit clientIp) and
  // retained on Registration.ipAddress solely for abuse prevention / rate-limiting
  // (legitimate-interest basis) — never collected from the client payload and
  // never shown in the UI. See prisma/schema.prisma Registration.ipAddress.
  .superRefine((data, ctx) => applySharedRefinements(data, ctx));

// ─── Admin registration edit (P2.5) ──────────────────────────────────────────
// Editable fields: registrant home centre, accommodation, status, and each
// participant's two pricing tiers. The stay days and the meal selection stay
// immutable because existing Participant/ParticipantMeal rows reference them.
// Everything editable here that moves money is re-priced server-side through the
// real engine before the write (invariants 3–4) — accommodation since M39, the
// two tiers since M40c.
const registrationStatusValues = ["REGISTERED", "CANCELLED", "PAID"] as const;

// Per-participant tier edit. Both tiers are always sent for a participant the
// admin can see, and the service re-prices only the ones that actually moved —
// so a status-only save still writes no price. Whether THIS event offers a given
// tier is checked in the service, which is the only layer holding the event.
const registrationParticipantTierSchema = z.object({
  id: z.string().min(1).max(64),
  pricingType: z.enum(pricingTypeValues),
  mealPricingType: z.enum(pricingTypeValues),
});

export const registrationUpdateSchema = z.object({
  centerId: z.string().min(1).max(64),
  hasAccommodation: z.boolean(),
  status: z.enum(registrationStatusValues),
  // Optional so a client that predates the tier editor keeps working untouched:
  // absent means "leave every tier exactly as stored", never "reset to STANDARD".
  participants: z.array(registrationParticipantTierSchema).max(10).optional(),
});

// ─── Admin registration export (P7) ───────────────────────────────────────────
// Filters mirror the admin registrations list (event scope, hosting centre,
// status, on-site search by reg number / email) plus an optional created-date
// range; the export re-applies them server-side under the SAME role/ownership
// scope (a client never widens what it may see). The export is XLSX-only (CSV was
// dropped); `lang` localizes the file's labels to the admin's UI language. In
// practice it's always scoped to one event (eventId set) — see AdminEventsTable.
const exportFormatValues = ["excel"] as const;
const exportLangValues = ["cs", "en"] as const;

export const registrationExportSchema = z.object({
  eventId: z.string().min(1).max(64).optional(),
  centerId: z.string().min(1).max(64).optional(),
  status: z.enum(registrationStatusValues).optional(),
  dateFrom: z.string().max(10).optional(), // YYYY-MM-DD, inclusive (UTC-day boundary)
  dateTo: z.string().max(10).optional(), // YYYY-MM-DD, inclusive
  search: z.string().max(100).optional(),
  format: z.enum(exportFormatValues).default("excel"),
  lang: z.enum(exportLangValues).default("cs"),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type CalculatePriceInput = z.infer<typeof calculatePriceSchema>;
export type RegistrationSubmitInput = z.infer<typeof registrationSubmitSchema>;
export type RegistrationUpdateInput = z.infer<typeof registrationUpdateSchema>;
export type RegistrationExportInput = z.infer<typeof registrationExportSchema>;
