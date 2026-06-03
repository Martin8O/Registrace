import { z } from "zod";

// ─── Enum value tuples (mirror Prisma enums without importing from generated client) ───

const ageCategoryValues = ["AGE_0_3", "AGE_4_7", "AGE_8_14", "AGE_15_PLUS"] as const;
const pricingTypeValues = ["STANDARD", "SUPPORTED", "SURPLUS"] as const;
const arrivalTimeValues = ["MORNING", "AFTERNOON", "EVENING"] as const;
const earlyDepartureValues = ["NONE", "AFTER_BREAKFAST"] as const;

// ─── Participant schemas ──────────────────────────────────────────────────────

const calculateParticipantSchema = z.object({
  ageCategory: z.enum(ageCategoryValues),
  pricingType: z.enum(pricingTypeValues).optional(),
  mealIds: z.array(z.string()),
});

const submitParticipantSchema = calculateParticipantSchema.extend({
  fullName: z.string().min(2),
});

// ─── Shared base fields ───────────────────────────────────────────────────────

const baseFields = {
  eventId: z.string().min(1),
  arrivalDateId: z.string().min(1),
  arrivalTime: z.enum(arrivalTimeValues),
  departureDateId: z.string().min(1),
  earlyDeparture: z.enum(earlyDepartureValues),
  hasAccommodation: z.boolean(),
  honeypot: z.string().optional(),
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
    centerId: z.string().min(1),
    email: z.string().email(),
    gdprConsent: z.literal(true),
    participants: z.array(submitParticipantSchema).min(1).max(10),
  })
  .superRefine((data, ctx) => applySharedRefinements(data, ctx));

// ─── Inferred types ───────────────────────────────────────────────────────────

export type CalculatePriceInput = z.infer<typeof calculatePriceSchema>;
export type RegistrationSubmitInput = z.infer<typeof registrationSubmitSchema>;
