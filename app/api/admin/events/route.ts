import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/guard";
import { eventCreateSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  return NextResponse.json({ data: [] });
}

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const body: unknown = await req.json();
  const result = eventCreateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  return NextResponse.json({ data: null }, { status: 201 });
}
