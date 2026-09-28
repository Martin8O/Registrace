import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { readJsonBody, fullEditErrorResponse } from "@/app/api/_lib/full-edit";
import { registrationFullPreviewSchema } from "@/lib/validation";
import { previewFullUpdate } from "@/modules/registrations";

// POST — the live price of an admin's in-progress full edit (M50). Writes nothing.
// The admin counterpart of the public calculate-price: that one reads the event
// through public visibility and answers 404 for an event that is running late or
// already over — exactly where registrations get fixed. This one reaches the event
// through the registration, ownership-scoped, and refuses what the save refuses —
// except a concurrent save and a full event on un-cancelling, which only the save
// can know.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard.response;

  const parsed = await readJsonBody(req);
  if ("response" in parsed) return parsed.response;
  const result = registrationFullPreviewSchema.safeParse(parsed.body);
  if (!result.success) return validationError(result.error);

  const { id } = await params;
  try {
    return NextResponse.json({ data: await previewFullUpdate(id, result.data, guard.ctx) });
  } catch (err) {
    const refused = fullEditErrorResponse(err);
    if (refused) return refused;
    throw err;
  }
}
