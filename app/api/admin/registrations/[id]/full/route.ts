import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { readJsonBody, fullEditErrorResponse } from "@/app/api/_lib/full-edit";
import { registrationFullUpdateSchema } from "@/lib/validation";
import { applyFullUpdate } from "@/modules/registrations";

// PUT — the admin FULL edit of a registration (M50): stay, accommodation, home
// centre, status and the whole participant list with their meals. The server
// re-prices through the real engine and writes everything in one transaction,
// only if nobody saved the registration since the editor loaded it (409).
// No e-mail is sent. 400 invalid body, 403 not-owner, 404 missing, 409 changed /
// capacity, 422 a well-formed body naming something this event does not allow.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard.response;

  const parsed = await readJsonBody(req);
  if ("response" in parsed) return parsed.response;
  const result = registrationFullUpdateSchema.safeParse(parsed.body);
  if (!result.success) return validationError(result.error);

  const { id } = await params;
  try {
    const saved = await applyFullUpdate(id, result.data, guard.ctx);
    return NextResponse.json({ data: saved });
  } catch (err) {
    const refused = fullEditErrorResponse(err);
    if (refused) return refused;
    throw err;
  }
}
