import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { getCentersForSelect } from "@/modules/events";
import { prisma } from "@/lib/db";

const centerCreateSchema = z.object({
  name_cs: z.string().min(1),
  name_en: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

// GET — active centres for selects.
export async function GET() {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const centers = await getCentersForSelect();
  return NextResponse.json({ data: centers });
}

// POST — add a centre (minimal; the centres page may create one).
export async function POST(req: NextRequest) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

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
