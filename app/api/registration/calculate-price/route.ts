import { NextRequest, NextResponse } from "next/server";
import { calculatePriceSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const body: unknown = await req.json();
  const result = calculatePriceSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  return NextResponse.json({ totalPrice: 0, participants: [] });
}
