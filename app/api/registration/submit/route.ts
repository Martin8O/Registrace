import { NextRequest, NextResponse } from "next/server";
import { validationError } from "@/app/api/_lib/http";
import { clientIp, enforceRateLimit } from "@/lib/security/rate-limit";
import { registrationSubmitSchema, type RegistrationSubmitInput } from "@/lib/validation";
import {
  submitRegistration,
  RegistrationCapacityError,
  RegistrationEventNotFoundError,
  RegistrationStayMismatchError,
} from "@/modules/registrations";

// POST /api/registration/submit — thin wrapper over modules/registrations
// (invariant 8). Validation here, persistence/idempotency/capacity/email in
// the service. Prices are recomputed server-side (invariants 3–4).

// Honeypot (invariant 18): checked on the RAW body, before Zod — the schema
// rejects a non-empty honeypot as a validation issue, but bots must receive an
// unremarkable 200, not a 422 revealing the trap.
function rawHoneypot(body: unknown): string {
  if (typeof body !== "object" || body === null || !("honeypot" in body)) return "";
  const value = (body as { honeypot: unknown }).honeypot;
  return typeof value === "string" ? value : "";
}

// Email language: next-intl's NEXT_LOCALE cookie, falling back to the referer
// path's locale segment, defaulting to cs. (The submit payload carries no
// locale — keeping the frozen-ish schema untouched in B7d.)
function emailLang(req: NextRequest): "cs" | "en" {
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (cookie === "cs" || cookie === "en") return cookie;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const path = new URL(referer).pathname;
      if (path === "/en" || path.startsWith("/en/")) return "en";
    } catch {
      /* unparsable referer — fall through to default */
    }
  }
  return "cs";
}

export async function POST(req: NextRequest) {
  // Rate limit (P4): 10 submits / IP / hour, before any parsing.
  const limited = enforceRateLimit(req, { bucket: "submit", limit: 10, windowMs: 3_600_000 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (rawHoneypot(body) !== "") {
    console.warn(`[registration/submit] honeypot triggered (ip: ${clientIp(req) ?? "unknown"})`);
    return NextResponse.json({ registrationId: "bot-detected", confirmationSent: false });
  }

  const result = registrationSubmitSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
  }

  // Extract only known fields (anti-tampering) — never spread the raw body.
  const d = result.data;
  const input: RegistrationSubmitInput = {
    eventId: d.eventId,
    arrivalDateId: d.arrivalDateId,
    arrivalTime: d.arrivalTime,
    departureDateId: d.departureDateId,
    earlyDeparture: d.earlyDeparture,
    hasAccommodation: d.hasAccommodation,
    honeypot: d.honeypot,
    idempotencyKey: d.idempotencyKey,
    centerId: d.centerId,
    email: d.email,
    gdprConsent: d.gdprConsent,
    participants: d.participants.map((p) => ({
      fullName: p.fullName,
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealIds: p.mealIds,
    })),
  };

  try {
    const outcome = await submitRegistration(input, {
      ipAddress: clientIp(req),
      lang: emailLang(req),
    });
    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof RegistrationEventNotFoundError) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (err instanceof RegistrationCapacityError) {
      return NextResponse.json({ error: "Event capacity reached" }, { status: 409 });
    }
    if (err instanceof RegistrationStayMismatchError) {
      // Invalid request data (ids not on this event) → 400, not 422 (P3: 422 no
      // longer signifies anything validation-related).
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
