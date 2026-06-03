import { z } from "zod";

// ─── Enum value tuples ────────────────────────────────────────────────────────

const eventStatusValues = ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"] as const;

// ─── Base shape ───────────────────────────────────────────────────────────────

const eventFields = {
  title_cs: z.string().min(1),
  title_en: z.string().min(1),
  subtitle_cs: z.string().optional(),
  subtitle_en: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  status: z.enum(eventStatusValues),
  maxRegistrations: z.number().int().positive().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
};

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

export const eventUpdateSchema = z
  .object(eventFields)
  .partial()
  .superRefine((data, ctx) => requireEndAfterStart(data, ctx));

export const eventStatusSchema = z.object({
  status: z.enum(eventStatusValues),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type EventStatusInput = z.infer<typeof eventStatusSchema>;
