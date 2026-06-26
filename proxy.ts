import createMiddleware from 'next-intl/middleware';
import { defineRouting } from 'next-intl/routing';
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { clientIp, rateLimit, rateLimitResponse } from '@/lib/security/rate-limit';
import { isMutating, isSameOrigin, csrfFailureResponse } from '@/lib/security/csrf';

const routing = defineRouting({
  locales: ['cs', 'en'],
  defaultLocale: 'cs',
});

const handleI18nRouting = createMiddleware(routing);

// Single middleware (Next.js 16 / next-intl convention — there is no
// middleware.ts). It composes next-intl locale routing with the Supabase session
// + the P4 edge hardening for the admin API:
//   • /api/admin/**  → rate-limit (120/min/IP) + CSRF (mutations) + 401 JSON when
//     unauthenticated. Edge enforces session PRESENCE + abuse controls only.
//   • /[locale]/admin/**  → redirect to /[locale]/admin/login when unauthenticated
//     (the login route itself passes through).
//   • everything else (public pages, other /api, static) passes through,
//     with the Supabase session refreshed so auth cookies stay live.
//
// DECISION C (P4): the authoritative role/ownership check (SUPER_ADMIN vs ADMIN,
// Event.createdBy) is NOT done here — Prisma can't run in the edge runtime. It
// lives at the handler/service layer (requireAdminContext / requireSuperAdmin /
// the *Ownership errors). Edge + handler are two deliberate layers (defence in
// depth), not one. This is the resolution of the former TODO(B7)/TODO(P4) markers.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── /api branch: no locale logic. Only /api/admin/** reaches here (matcher). ──
  if (pathname.startsWith('/api/')) {
    if (pathname.startsWith('/api/admin')) {
      // Order: cheapest checks first, the Supabase round-trip last.
      // 1) Rate limit: 120 requests / IP / minute across all admin APIs.
      const rl = rateLimit(`admin:${clientIp(request) ?? 'unknown'}`, 120, 60_000);
      if (!rl.ok) return rateLimitResponse(rl);

      // 2) CSRF: mutating admin requests must originate from our own origin.
      if (isMutating(request.method) && !isSameOrigin(request)) {
        return csrfFailureResponse();
      }

      // 3) Session presence (real role/ownership asserted in the handlers — see
      //    DECISION C above).
      const { user } = await updateSession(request);
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    return NextResponse.next();
  }

  // ── Page branch: next-intl routing first (locale prefixing/redirects), then
  //    refresh the Supabase session and carry its cookies onto the response. ──
  const response = handleI18nRouting(request);
  const { supabaseResponse, user } = await updateSession(request);
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  // ── Admin pages: redirect unauthenticated requests to the localized login. ──
  const adminMatch = pathname.match(/^\/(cs|en)\/admin(?:\/(.*))?$/);
  if (adminMatch) {
    const locale = adminMatch[1];
    const rest = adminMatch[2] ?? '';
    // login + set-password are reachable WITHOUT a prior server session: login is
    // the entry point, and set-password receives its session from the invite/reset
    // token in the URL fragment (which the edge can't see) — the client
    // establishes it after load. Redirecting them to login would break both.
    const isPublicAdminRoute =
      rest === 'login' ||
      rest.startsWith('login/') ||
      rest === 'set-password' ||
      rest.startsWith('set-password/');
    // DECISION C (P4): edge does session presence only — role/ownership scoping
    // for admin PAGES is enforced server-side when each page loads its data via
    // getAdminContext (Prisma can't run at the edge). Unauthenticated → login.
    if (!user && !isPublicAdminRoute) {
      const loginUrl = new URL(`/${locale}/admin/login`, request.url);
      const redirect = NextResponse.redirect(loginUrl);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirect.cookies.set(cookie);
      });
      return redirect;
    }
  }

  return response;
}

export const config = {
  // First pattern: all pages except /api, _next, _vercel, and files with an
  // extension. Second pattern: admin API routes only (other /api stays excluded,
  // so locale logic never runs on them — we branch on /api/ inside the function).
  matcher: [
    '/((?!api|_next|_vercel|.*\\..*).*)',
    '/api/admin/:path*',
  ],
};
