import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import {
  resendConfirmation,
  RegistrationNotFoundError,
  RegistrationForbiddenError,
} from "@/modules/registrations";

// POST — re-send the confirmation email (existing basic template; P6 upgrades
// it). Ownership-checked. The response carries the honest send result, including
// the Resend test-mode case where a non-owner recipient is rejected
// (confirmationSent:false) — the UI surfaces that rather than faking success.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard.response;

  const { id } = await params;
  // Optional language hint from the calling admin's locale; defaults to cs.
  let lang: "cs" | "en" = "cs";
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && (body as { lang?: unknown }).lang === "en") {
      lang = "en";
    }
  } catch {
    // No/invalid body — keep the cs default.
  }

  try {
    const result = await resendConfirmation(id, guard.ctx, lang);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof RegistrationForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof RegistrationNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
