// lib/security/csrf — CSRF (cross-site request forgery) defence for the admin
// API (P4). Edge- and Node-safe (header/URL logic only). A forged cross-site
// request automatically carries the admin's session cookie, but a browser cannot
// forge a truthful same-origin Origin/Referer header — so we reject any mutating
// admin request whose origin isn't ours. Public endpoints aren't cookie-
// authenticated, so classic CSRF doesn't apply there; this guards /api/admin/*.

import { NextResponse } from "next/server";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

function expectedOrigin(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return null;
  try {
    return new URL(appUrl).origin;
  } catch {
    return null;
  }
}

function originFromHeaders(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }
  // Browsers sometimes omit Origin on same-origin requests → fall back to Referer.
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

function isLocalhost(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

// FAIL-CLOSED: a missing NEXT_PUBLIC_APP_URL (in production) or an absent/
// mismatched Origin+Referer all return false → the caller 403s. In development
// we also accept any localhost origin, so a mismatched dev port / env value
// doesn't 403 the admin panel locally while production stays strict.
export function isSameOrigin(req: Request): boolean {
  const actual = originFromHeaders(req);
  if (!actual) return false;
  const expected = expectedOrigin();
  if (expected && actual === expected) return true;
  if (process.env.NODE_ENV !== "production" && isLocalhost(actual)) return true;
  return false;
}

export function csrfFailureResponse(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
