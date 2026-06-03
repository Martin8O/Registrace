import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/guard";
import { eventStatusSchema } from "@/lib/validation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = eventStatusSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  return NextResponse.json({ data: null });
}
