import { z } from "zod";

// ─── Enum value tuples (mirror Prisma enums without importing from generated client) ───

const ageCategoryValues = ["AGE_0_3", "AGE_4_7", "AGE_8_14", "AGE_15_PLUS"] as const;
const pricingTypeValues = ["STANDARD", "SUPPORTED", "SURPLUS"] as const;
const arrivalTimeValues = ["MORNING", "AFTERNOON", "EVENING"] as const;
const earlyDepartureValues = ["NONE", "AFTER_BREAKFAST"] as const;

// ─── Participant schemas ──────────────────────────────────────────────────────

// String length caps (P8 item 7): every free-text/id input is bounded so a
// hostile client can't post multi-MB strings. IDs are cuid/uuid (~25–36 chars) →
// 64 is generous; names/emails use RFC-ish ceilings.
const calculateParticipantSchema = z.object({
  ageCategory: z.enum(ageCategoryValues),
  pricingType: z.enum(pricingTypeValues).optional(),
  mealIds: z.array(z.string().min(1).max(64)).max(200),
});

const submitParticipantSchema = calculateParticipantSchema.extend({
  fullName: z.string().min(2).max(100),
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

function applySharedRefinements(data: RefineableBase, ctx: z.RefinementCtx): void {
  if (data.honeypot !== undefined && data.honeypot !== "") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bot detected",
      path: ["honeypot"],
    });
  }

  data.participants.forEach((p, i) => {
    if (p.ageCategory !== "AGE_15_PLUS" && p.pricingType !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pricingType only applies to AGE_15_PLUS participants",
        path: ["participants", i, "pricingType"],
      });
    }
  });
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
// Editable fields only (decision 2): registrant home centre, accommodation, and
// status. Price is never recomputed here (P5 owns pricing); the stay days/meals
// are immutable because existing Participant/ParticipantMeal rows reference them.
const registrationStatusValues = ["REGISTERED", "CANCELLED", "PAID"] as const;

export const registrationUpdateSchema = z.object({
  centerId: z.string().min(1).max(64),
  hasAccommodation: z.boolean(),
  status: z.enum(registrationStatusValues),
});

// ─── Admin registration export (P7) ───────────────────────────────────────────
// Filters mirror the admin registrations list (event scope, hosting centre,
// status, on-site search by reg number / email) plus an optional created-date
// range; the export re-applies them server-side under the SAME role/ownership
// scope (a client never widens what it may see). `format` picks CSV vs Excel;
// `lang` localizes the file's labels — the admin's UI language, with an EN-UI
// prompt offering Czech (see RegistrationsTable).
const exportFormatValues = ["csv", "excel"] as const;
const exportLangValues = ["cs", "en"] as const;

export const registrationExportSchema = z.object({
  eventId: z.string().min(1).max(64).optional(),
  centerId: z.string().min(1).max(64).optional(),
  status: z.enum(registrationStatusValues).optional(),
  dateFrom: z.string().max(10).optional(), // YYYY-MM-DD, inclusive (UTC-day boundary)
  dateTo: z.string().max(10).optional(), // YYYY-MM-DD, inclusive
  search: z.string().max(100).optional(),
  format: z.enum(exportFormatValues),
  lang: z.enum(exportLangValues).default("cs"),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type CalculatePriceInput = z.infer<typeof calculatePriceSchema>;
export type RegistrationSubmitInput = z.infer<typeof registrationSubmitSchema>;
export type RegistrationUpdateInput = z.infer<typeof registrationUpdateSchema>;
export type RegistrationExportInput = z.infer<typeof registrationExportSchema>;
