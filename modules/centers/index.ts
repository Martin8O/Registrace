// modules/centers — SUPER_ADMIN centre management (invariant 20). Reads every
// centre with its assigned ADMIN emails (derived from UserCenter); renames are
// the only mutation (name_cs/_en). Thin handlers call these (invariant 8).

import { prisma } from "@/lib/db";
import type { AdminContext } from "@/modules/auth";
import type { CenterCreateInput, CenterUpdateInput } from "@/lib/validation";

export type AdminCenterListItem = {
  id: string;
  name_cs: string;
  name_en: string;
  isActive: boolean; // false = "deleted" (hidden from every picker, kept for referential integrity)
  adminEmails: string[]; // ADMIN users assigned to this centre (SUPER_ADMINs see all, not listed per-centre)
};

function assertSuperAdmin(ctx: AdminContext): void {
  if (ctx.role !== "SUPER_ADMIN") throw new Error("Forbidden: SUPER_ADMIN only");
}

// All centres (active + inactive) alphabetically, each with the emails of the
// ADMINs administering it (via UserCenter). SUPER_ADMINs aren't listed per-centre
// since they implicitly cover all.
export async function listCentersAdmin(ctx: AdminContext): Promise<AdminCenterListItem[]> {
  assertSuperAdmin(ctx);
  const centers = await prisma.center.findMany({
    orderBy: { name_cs: "asc" },
    include: { admins: { include: { user: true } } },
  });
  return centers.map((c) => ({
    id: c.id,
    name_cs: c.name_cs,
    name_en: c.name_en,
    isActive: c.isActive,
    adminEmails: c.admins
      .filter((uc) => uc.user.role === "ADMIN")
      .map((uc) => uc.user.email),
  }));
}

// Rename a centre (the only editable fields). SUPER_ADMIN only.
export async function updateCenter(
  id: string,
  input: CenterUpdateInput,
  ctx: AdminContext,
): Promise<{ id: string }> {
  assertSuperAdmin(ctx);
  await prisma.center.update({
    where: { id },
    data: { name_cs: input.name_cs, name_en: input.name_en },
  });
  return { id };
}

// Create a new centre. SUPER_ADMIN only. It becomes active immediately, so it
// shows up in every picker (getCentersForSelect filters isActive). It gets a
// normal-band sortOrder (0) so getCentersForSelect orders it alphabetically by
// name — only the special entries ("Jiné" / "Mimo ČR", sortOrder ≥ 240) stay
// pinned last. The exact value is otherwise irrelevant (ordering is by name).
export async function createCenter(
  input: CenterCreateInput,
  ctx: AdminContext,
): Promise<{ id: string }> {
  assertSuperAdmin(ctx);
  const c = await prisma.center.create({
    data: {
      name_cs: input.name_cs,
      name_en: input.name_en,
      isActive: true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return { id: c.id };
}

// "Delete" / restore a centre = flip isActive (invariant 9: no permanent
// deletion; a hard delete would also hit the RESTRICT FKs from events /
// registrations / admin-assignments). Inactive centres vanish from every picker
// and the public site but keep all existing references intact.
export async function setCenterActive(
  id: string,
  active: boolean,
  ctx: AdminContext,
): Promise<{ id: string }> {
  assertSuperAdmin(ctx);
  await prisma.center.update({ where: { id }, data: { isActive: active } });
  return { id };
}
