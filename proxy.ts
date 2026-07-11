import createMiddleware from 'next-intl/middleware';
import { defineRouting } from 'next-intl/routing';
import { NextResponse, NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { clientIp, rateLimit, rateLimitResponse } from '@/lib/security/rate-limit';
import { isMutating, isSameOrigin, csrfFailureResponse } from '@/lib/security/csrf';
import { buildCsp, generateNonce } from '@/lib/security/csp';

const routing = defineRouting({
  locales: ['cs', 'en'],
  defaultLocale: 'cs',
  // NEXT_LOCALE cookie hardening: next-intl doesn't set Secure by default, which
  // MDN Observatory flags (−5, "cookie without Secure flag"). Secure only in prod
  // — a Secure cookie over http://localhost would be dropped in dev. sameSite:lax
  // keeps the locale surviving top-level navigations from external links.
  localeCookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
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
  // Content-Security-Policy is set HERE (per request), not in next.config.ts,
  // because production uses a per-request nonce so 'unsafe-inline' can be dropped
  // from script-src (the static policy gave CSP no real XSS mitigation). In
  // production we forward the nonce to the renderer via request headers so Next
  // tags its own inline scripts with it (Next reads the nonce from the request
  // CSP header); next-intl carries those headers through its rewrite. In dev we
  // keep the permissive no-nonce policy so HMR is untouched. The other security
  // headers stay static in next.config.ts.
  const isDev = process.env.NODE_ENV !== 'production';
  let i18nRequest = request;
  let csp: string;
  if (isDev) {
    csp = buildCsp({ isDev: true });
  } else {
    const nonce = generateNonce();
    csp = buildCsp({ nonce, isDev: false });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', csp);
    i18nRequest = new NextRequest(request, { headers: requestHeaders });
  }

  const response = handleI18nRouting(i18nRequest);
  response.headers.set('content-security-policy', csp);
  const { supabaseResponse, user } = await updateSession(request);
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  // ── Admin pages: redirect unauthenticated requests to the localized login. ──
  const adminMatch = pathname.match(/^\/(cs|en)\/admin(?:\/(.*))?$/);
  if (adminMatch) {
    const locale = adminMatch[1];
    const rest = adminMatch[2] ?? '';
    // These admin routes are reachable WITHOUT a prior server session:
    //  • login            — the entry point.
    //  • auth/confirm      — verifies the invite/reset token (verifyOtp) and only
    //                        THEN establishes a session; redirecting it to login
    //                        first would mean the token is never verified.
    //  • set-password      — loaded after auth/confirm has set the session.
    // Redirecting any of them to login would break the password-setup flow.
    const isPublicAdminRoute =
      rest === 'login' ||
      rest.startsWith('login/') ||
      rest === 'auth/confirm' ||
      rest.startsWith('auth/confirm/') ||
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
      redirect.headers.set('content-security-policy', csp);
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
