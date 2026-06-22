import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { eventStatusSchema } from "@/lib/validation";
import { setEventStatus, EventNotFoundError, EventOwnershipError } from "@/modules/events";

// PATCH — change an event's lifecycle status, ownership-scoped. 422 invalid,
// 403 not-owner, 404 missing. Manual transition only (cron = deploy concern).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = eventStatusSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  try {
    await setEventStatus(id, result.data.status, guard.ctx);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    if (err instanceof EventOwnershipError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof EventNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
