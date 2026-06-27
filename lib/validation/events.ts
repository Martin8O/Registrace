import { z } from "zod";

// ─── Enum value tuples (mirror Prisma enums; client-safe, no generated import) ──

const eventStatusValues = ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"] as const;
const ageCategoryValues = ["AGE_0_3", "AGE_4_7", "AGE_8_14", "AGE_15_PLUS"] as const;
const pricingTypeValues = ["STANDARD", "SUPPORTED", "SURPLUS"] as const;
const mealTypeValues = ["BREAKFAST", "LUNCH", "DINNER"] as const;

// ─── Base shape ───────────────────────────────────────────────────────────────

// String length caps (P8 item 7) — bound every free-text/id input.
const eventFields = {
  centerId: z.string().min(1).max(64),
  title_cs: z.string().min(1).max(200),
  title_en: z.string().min(1).max(200),
  subtitle_cs: z.string().max(300).optional(),
  subtitle_en: z.string().max(300).optional(),
  description_cs: z.string().max(5000).optional(),
  description_en: z.string().max(5000).optional(),
  contactName: z.string().max(200).optional(),
  contactPhone: z.string().max(50).optional(),
  contactEmail: z.string().email().max(254).optional(),
  status: z.enum(eventStatusValues),
  maxRegistrations: z.number().int().positive().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  // Optional meal-ordering cut-off as a Europe/Prague wall-clock "YYYY-MM-DDTHH:mm"
  // string (a <input type="datetime-local"> value). Converted to a UTC instant in
  // the service (createEvent/updateEvent). Window enforced by requireDeadlineInWindow.
  // An empty string is accepted as an explicit "clear" signal on update (the
  // service stores null); an absent key on update means "leave unchanged".
  mealRegistrationDeadline: z
    .union([
      z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Invalid datetime"),
      z.literal(""),
    ])
    .optional(),
};

// ─── Relation child shapes (the full create payload) ────────────────────────────

const eventDateInputSchema = z.object({
  date: z.string().min(1).max(40), // ISO yyyy-mm-dd
  label_cs: z.string().min(1).max(100),
  label_en: z.string().min(1).max(100),
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
  date: z.string().min(1).max(40), // ISO yyyy-mm-dd — matched to the created EventDate
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

// The meal-ordering deadline must sit in a sensible window: not after the event's
// end date, and not more than a week before its start (both make no sense). Date
// granularity (the day component of the deadline vs the event days, all UTC).
function requireDeadlineInWindow(
  data: { startDate?: Date; endDate?: Date; mealRegistrationDeadline?: string },
  ctx: z.RefinementCtx
): void {
  if (!data.mealRegistrationDeadline || !data.startDate || !data.endDate) return;
  const deadlineDay = new Date(`${data.mealRegistrationDeadline.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(deadlineDay.getTime())) return;
  const minDay = new Date(data.startDate);
  minDay.setUTCDate(minDay.getUTCDate() - 7);
  const endDay = new Date(
    `${data.endDate.toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  if (deadlineDay < new Date(`${minDay.toISOString().slice(0, 10)}T00:00:00.000Z`) || deadlineDay > endDay) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Meal deadline must be within a week before the start and no later than the end",
      path: ["mealRegistrationDeadline"],
    });
  }
}

// ─── Public schemas ───────────────────────────────────────────────────────────

export const eventCreateSchema = z
  .object(eventFields)
  .superRefine((data, ctx) => {
    requireEndAfterStart(data, ctx);
    requireDeadlineInWindow(data, ctx);
  });

// Full create payload = the scalar fields (one shared definition) composed with
// the relation arrays. Used by both the admin form and the POST handler.
export const eventCreateWithRelationsSchema = z
  .object({
    ...eventFields,
    dates: z.array(eventDateInputSchema).min(1),
    pricingRules: z.array(pricingRuleInputSchema),
    meals: z.array(eventMealInputSchema),
  })
  .superRefine((data, ctx) => {
    requireEndAfterStart(data, ctx);
    requireDeadlineInWindow(data, ctx);
  });

// Update accepts the scalar fields (all optional) AND, for a fully-editable
// DRAFT, the same relation arrays as create — the service replaces them only
// when the event is a draft with no registrations; a locked event ignores them.
export const eventUpdateSchema = z
  .object({
    ...eventFields,
    dates: z.array(eventDateInputSchema).optional(),
    pricingRules: z.array(pricingRuleInputSchema).optional(),
    meals: z.array(eventMealInputSchema).optional(),
  })
  .partial()
  .superRefine((data, ctx) => {
    requireEndAfterStart(data, ctx);
    requireDeadlineInWindow(data, ctx);
  });

export const eventStatusSchema = z.object({
  status: z.enum(eventStatusValues),
});

// ─── Centre schema (admin) — moved here from the centers route (P2 item 3: no
// Zod schemas defined outside lib/validation) ───────────────────────────────────
export const centerCreateSchema = z.object({
  name_cs: z.string().min(1).max(200),
  name_en: z.string().min(1).max(200),
  sortOrder: z.number().int().optional(),
});

// Centre rename (P2.5) — SUPER_ADMIN only. Names are the only editable fields
// (isActive/sortOrder are not exposed in the admin UI).
export const centerUpdateSchema = z.object({
  name_cs: z.string().min(1).max(200),
  name_en: z.string().min(1).max(200),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventCreateWithRelationsInput = z.infer<typeof eventCreateWithRelationsSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type EventStatusInput = z.infer<typeof eventStatusSchema>;
export type CenterCreateInput = z.infer<typeof centerCreateSchema>;
export type CenterUpdateInput = z.infer<typeof centerUpdateSchema>;
