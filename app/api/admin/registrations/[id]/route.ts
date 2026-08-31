import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { registrationUpdateSchema } from "@/lib/validation";
import {
  getRegistrationForDetail,
  updateRegistration,
  RegistrationNotFoundError,
  RegistrationForbiddenError,
  RegistrationCenterInvalidError,
  RegistrationPricingTypeUnavailableError,
  RegistrationParticipantMismatchError,
} from "@/modules/registrations";

// GET — one registration (full detail), ownership-scoped. Missing/not-owned → 404.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const registration = await getRegistrationForDetail(id, guard.ctx);
  if (!registration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: registration });
}

// PUT — edit home centre / accommodation / status / each participant's two
// pricing tiers. Anything that moves money is re-priced server-side by the real
// engine before the write. 422 invalid, 403 not-owner, 404 missing.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = registrationUpdateSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
  }

  try {
    await updateRegistration(id, result.data, guard.ctx);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    if (err instanceof RegistrationForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof RegistrationNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof RegistrationCenterInvalidError) {
      return NextResponse.json({ error: "Unknown or inactive center" }, { status: 422 });
    }
    // A tier this event does not offer, or a participant from another
    // registration — both are a well-formed body naming something invalid, so
    // they share the 422 lane with the unknown-centre case (400 stays Zod's).
    if (err instanceof RegistrationPricingTypeUnavailableError) {
      return NextResponse.json({ error: "Pricing tier not offered by this event" }, { status: 422 });
    }
    if (err instanceof RegistrationParticipantMismatchError) {
      return NextResponse.json({ error: "Unknown participant" }, { status: 422 });
    }
    throw err;
  }
}
