import { z } from "zod";

// ─── Enum value tuples (mirror Prisma enums; client-safe, no generated import) ──

const eventStatusValues = ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"] as const;
const ageCategoryValues = ["AGE_0_3", "AGE_4_7", "AGE_8_14", "AGE_15_PLUS"] as const;
const pricingTypeValues = ["STANDARD", "SUPPORTED", "SURPLUS"] as const;
const mealTypeValues = ["BREAKFAST", "LUNCH", "DINNER"] as const;

// ─── Base shape ───────────────────────────────────────────────────────────────

const eventFields = {
  centerId: z.string().min(1),
  title_cs: z.string().min(1),
  title_en: z.string().min(1),
  subtitle_cs: z.string().optional(),
  subtitle_en: z.string().optional(),
  description_cs: z.string().optional(),
  description_en: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  status: z.enum(eventStatusValues),
  maxRegistrations: z.number().int().positive().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
};

// ─── Relation child shapes (the full create payload) ────────────────────────────

const eventDateInputSchema = z.object({
  date: z.string().min(1), // ISO yyyy-mm-dd
  label_cs: z.string().min(1),
  label_en: z.string().min(1),
  sortOrder: z.number().int(),
});

const pricingRuleInputSchema = z.object({
  ageCategory: z.enum(ageCategoryValues),
  pricingType: z.enum(pricingTypeValues),
  dailyRate: z.number().int().min(0),
  nightRate: z.number().int().min(0),
  morningArrivalDiscount: z.number().int().min(0),
  afternoonArrivalDiscount: z.number().int().min(0),
  eveningArrivalDiscount: z.number().int().min(0),
  earlyDepartureDiscount: z.number().int().min(0),
});

const eventMealInputSchema = z.object({
  date: z.string().min(1), // ISO yyyy-mm-dd — matched to the created EventDate
  mealType: z.enum(mealTypeValues),
  price: z.number().int().min(0),
  isClosed: z.boolean(),
});

// ─── Date order refinement ────────────────────────────────────────────────────

function requireEndAfterStart(
  data: { startDate?: Date; endDate?: Date },
  ctx: z.RefinementCtx
): void {
  if (
    data.startDate !== undefined &&
    data.endDate !== undefined &&
    data.endDate < data.startDate
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "endDate must be on or after startDate",
      path: ["endDate"],
    });
  }
}

// ─── Public schemas ───────────────────────────────────────────────────────────

export const eventCreateSchema = z
  .object(eventFields)
  .superRefine((data, ctx) => requireEndAfterStart(data, ctx));

// Full create payload = the scalar fields (one shared definition) composed with
// the relation arrays. Used by both the admin form and the POST handler.
export const eventCreateWithRelationsSchema = z
  .object({
    ...eventFields,
    dates: z.array(eventDateInputSchema).min(1),
    pricingRules: z.array(pricingRuleInputSchema),
    meals: z.array(eventMealInputSchema),
  })
  .superRefine((data, ctx) => requireEndAfterStart(data, ctx));

export const eventUpdateSchema = z
  .object(eventFields)
  .partial()
  .superRefine((data, ctx) => requireEndAfterStart(data, ctx));

export const eventStatusSchema = z.object({
  status: z.enum(eventStatusValues),
});

// ─── Centre schema (admin) — moved here from the centers route (P2 item 3: no
// Zod schemas defined outside lib/validation) ───────────────────────────────────
export const centerCreateSchema = z.object({
  name_cs: z.string().min(1),
  name_en: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

// Centre rename (P2.5) — SUPER_ADMIN only. Names are the only editable fields
// (isActive/sortOrder are not exposed in the admin UI).
export const centerUpdateSchema = z.object({
  name_cs: z.string().min(1),
  name_en: z.string().min(1),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventCreateWithRelationsInput = z.infer<typeof eventCreateWithRelationsSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type EventStatusInput = z.infer<typeof eventStatusSchema>;
export type CenterCreateInput = z.infer<typeof centerCreateSchema>;
export type CenterUpdateInput = z.infer<typeof centerUpdateSchema>;
