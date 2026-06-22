import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { eventCreateWithRelationsSchema } from "@/lib/validation";
import { createEvent, listAdminEvents, EventOwnershipError } from "@/modules/events";

// GET — events the caller may see (ADMIN: own; SUPER_ADMIN: all). Thin (inv. 8).
export async function GET() {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const events = await listAdminEvents(guard.ctx);
  return NextResponse.json({ data: events });
}

// POST — create an event (+ dates, pricing, meals) in one transaction with
// createdBy from the session. Ownership violation → 403; validation → 422.
export async function POST(req: NextRequest) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const body: unknown = await req.json();
  const result = eventCreateWithRelationsSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
  }

  try {
    const { id } = await createEvent(result.data, guard.ctx);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof EventOwnershipError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
}
