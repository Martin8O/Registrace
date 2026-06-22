import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { centerCreateSchema } from "@/lib/validation";
import { getCentersForSelect } from "@/modules/events";
import { prisma } from "@/lib/db";

// GET — active centres for selects. Any authenticated admin (the event-create
// form needs the full centre list).
export async function GET() {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const centers = await getCentersForSelect();
  return NextResponse.json({ data: centers });
}

// POST — add a centre. SUPER_ADMIN only (P1 audit C2: centre management is
// SUPER_ADMIN-scoped; a plain ADMIN must not be able to create centres).
export async function POST(req: NextRequest) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;
  if (guard.ctx.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body: unknown = await req.json();
  const result = centerCreateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  const center = await prisma.center.create({
    data: {
      name_cs: result.data.name_cs,
      name_en: result.data.name_en,
      sortOrder: result.data.sortOrder ?? 0,
      isActive: true,
    },
  });

  return NextResponse.json(
    { data: { id: center.id, name_cs: center.name_cs, name_en: center.name_en } },
    { status: 201 },
  );
}
