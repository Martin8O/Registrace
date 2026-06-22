import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { eventUpdateSchema } from "@/lib/validation";
import {
  getEventForEdit,
  updateEvent,
  EventNotFoundError,
  EventOwnershipError,
} from "@/modules/events";

// GET — load one event for editing, ownership-scoped (ADMIN: own only). Missing
// or not-owned → 404 (never confirms another admin's event exists).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const event = await getEventForEdit(id, guard.ctx);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: event });
}

// PUT — persist scalar+status edits (relations/centre/dates immutable, §0
// decision 1). 422 invalid, 403 not-owner, 404 missing.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = eventUpdateSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
  }

  try {
    await updateEvent(id, result.data, guard.ctx);
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
