import { NextRequest, NextResponse } from "next/server";
import { getPublicEventForDetail } from "@/modules/events";

// GET /api/events/[id] — full PUBLIC event detail. Enforces public visibility
// (P1 audit H1): non-PUBLISHED / past events 404 here, so DRAFT details + contact
// PII never leak to anyone who knows the id. Thin wrapper (invariant 8).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await getPublicEventForDetail(id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json({ data: event });
}
