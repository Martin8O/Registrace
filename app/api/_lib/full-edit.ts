import { NextRequest, NextResponse } from "next/server";
import {
  RegistrationNotFoundError,
  RegistrationForbiddenError,
  RegistrationCenterInvalidError,
  RegistrationPricingTypeUnavailableError,
  RegistrationParticipantMismatchError,
  RegistrationStayInvalidError,
  RegistrationMealInvalidError,
  RegistrationChangedError,
  RegistrationCapacityError,
} from "@/modules/registrations";

// Shared by the two admin full-edit endpoints (M50) — the live price preview and
// the save refuse exactly the same things, so they answer them the same way.

// A body that is not JSON at all is a bad request, not a server fault (a bare
// req.json() would surface it as a 500).
export async function readJsonBody(req: NextRequest): Promise<{ body: unknown } | { response: NextResponse }> {
  try {
    return { body: await req.json() };
  } catch {
    return { response: NextResponse.json({ error: "Malformed JSON", code: "bad_json" }, { status: 400 }) };
  }
}

// Every refusal carries a stable `code` beside its message: the editor maps the
// code to a sentence saying what to DO, which a bare status cannot.
export function fullEditErrorResponse(err: unknown): NextResponse | null {
  const refuse = (status: number, error: string, code: string, extra: object = {}) =>
    NextResponse.json({ error, code, ...extra }, { status });

  if (err instanceof RegistrationForbiddenError) return refuse(403, "Forbidden", "forbidden");
  if (err instanceof RegistrationNotFoundError) return refuse(404, "Not found", "not_found");
  if (err instanceof RegistrationChangedError) {
    return refuse(409, "Registration was changed by someone else", "registration_changed");
  }
  if (err instanceof RegistrationCapacityError) return refuse(409, "Event capacity reached", "capacity_reached");
  if (err instanceof RegistrationStayInvalidError) {
    return refuse(422, err.message, "stay_invalid", { reason: err.reason });
  }
  if (err instanceof RegistrationMealInvalidError) {
    return refuse(422, err.message, err.code, { participantIndex: err.participantIndex, mealId: err.mealId });
  }
  if (err instanceof RegistrationCenterInvalidError) {
    return refuse(422, "Unknown or inactive center", "center_invalid");
  }
  if (err instanceof RegistrationPricingTypeUnavailableError) {
    return refuse(422, "Pricing tier not offered by this event", "tier_unavailable", {
      participantIndex: err.participantIndex,
      half: err.half,
    });
  }
  if (err instanceof RegistrationParticipantMismatchError) {
    return refuse(422, "Unknown participant", "participant_unknown");
  }
  return null;
}
