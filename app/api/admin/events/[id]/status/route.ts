import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { eventStatusSchema } from "@/lib/validation";
import {
  setEventStatus,
  EventNotFoundError,
  EventOwnershipError,
  EventStatusTransitionError,
} from "@/modules/events";

// PATCH — change an event's lifecycle status, ownership-scoped. 400 invalid,
// 403 not-owner, 404 missing. Manual transition only (cron = deploy concern).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = eventStatusSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
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
    if (err instanceof EventStatusTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
