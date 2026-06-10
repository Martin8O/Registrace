import { NextRequest, NextResponse } from "next/server";
import { getEventForDetail } from "@/modules/events";

// GET /api/events/[id] — full event detail (event + center + dates + meals +
// pricingRules). 404 when missing/deleted. Thin wrapper (invariant 8).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await getEventForDetail(id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json({ data: event });
}
