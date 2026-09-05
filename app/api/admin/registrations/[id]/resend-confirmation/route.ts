import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import {
  resendConfirmation,
  RegistrationNotFoundError,
  RegistrationForbiddenError,
  RegistrationCancelledError,
} from "@/modules/registrations";

// POST — re-send the production confirmation email (P6). Ownership-checked, and
// refused with 409 for a CANCELLED registration: the template confirms and bills,
// which is the opposite of what a cancelled booking means.
// Language is the registration's stored `locale` (the visitor's original
// language), resolved inside the service — the request needs no body. The
// response carries the honest send result, including the Resend test-mode case
// where a non-owner recipient is rejected (confirmationSent:false) — the UI
// surfaces that rather than faking success.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard.response;

  const { id } = await params;

  try {
    const result = await resendConfirmation(id, guard.ctx);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof RegistrationForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // 409, not 422: nothing about the request is wrong, the registration is in a
    // state this action does not apply to. The `code` is what lets the UI say WHY
    // instead of the generic failure — the same contract the PUT handler uses.
    if (err instanceof RegistrationCancelledError) {
      return NextResponse.json(
        { error: "Registration is cancelled", code: "registration_cancelled" },
        { status: 409 },
      );
    }
    if (err instanceof RegistrationNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
