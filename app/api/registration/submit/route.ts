import { NextRequest, NextResponse } from "next/server";
import { registrationSubmitSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const body: unknown = await req.json();
  const result = registrationSubmitSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  return NextResponse.json({ id: null, status: "PENDING" }, { status: 201 });
}
