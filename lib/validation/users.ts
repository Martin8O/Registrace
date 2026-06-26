import { z } from "zod";

// User-management schemas (P2.5) — SUPER_ADMIN-only invite + edit. Roles mirror
// the Prisma UserRole enum (client-safe tuple, no generated-client import).
// centerIds = the centres an ADMIN administers (via UserCenter); a SUPER_ADMIN
// sees all centres, so its assignment list is ignored server-side.

const userRoleValues = ["ADMIN", "SUPER_ADMIN"] as const;

// String length caps (P8 item 7) — email bounded to the RFC 5321 max; centre IDs
// are cuids (~25 chars) so 64 each is generous, list capped at the 25 seeded centres.
export const userInviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(userRoleValues),
  centerIds: z.array(z.string().min(1).max(64)).max(50),
});

export const userUpdateSchema = z.object({
  role: z.enum(userRoleValues),
  centerIds: z.array(z.string().min(1).max(64)).max(50),
});

export type UserInviteInput = z.infer<typeof userInviteSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
