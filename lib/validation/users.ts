import { z } from "zod";

// User-management schemas (P2.5) — SUPER_ADMIN-only invite + edit. Roles mirror
// the Prisma UserRole enum (client-safe tuple, no generated-client import).
// centerIds = the centres an ADMIN administers (via UserCenter); a SUPER_ADMIN
// sees all centres, so its assignment list is ignored server-side.

const userRoleValues = ["ADMIN", "SUPER_ADMIN"] as const;

export const userInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(userRoleValues),
  centerIds: z.array(z.string()),
});

export const userUpdateSchema = z.object({
  role: z.enum(userRoleValues),
  centerIds: z.array(z.string()),
});

export type UserInviteInput = z.infer<typeof userInviteSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
