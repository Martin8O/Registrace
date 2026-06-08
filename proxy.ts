import createMiddleware from 'next-intl/middleware';
import { defineRouting } from 'next-intl/routing';
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const routing = defineRouting({
  locales: ['cs', 'en'],
  defaultLocale: 'cs',
});

const handleI18nRouting = createMiddleware(routing);

// Single middleware (Next.js 16 / next-intl convention — there is no
// middleware.ts). It composes next-intl locale routing with Supabase
// session-presence guarding:
//   • /api/admin/**  → 401 JSON when unauthenticated (protects the frozen stub
//     routes at the edge; their internal requireAdmin is reconciled in P4).
//   • /[locale]/admin/**  → redirect to /[locale]/admin/login when unauthenticated
//     (the login route itself passes through).
//   • everything else (public pages, other /api, static) passes through,
//     with the Supabase session refreshed so auth cookies stay live.
// Guard is session-presence ONLY — no role lookup, no DB. See TODO(B7) below.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── /api branch: no locale logic. Only /api/admin/** reaches here (matcher). ──
  if (pathname.startsWith('/api/')) {
    if (pathname.startsWith('/api/admin')) {
      // TODO(B7): after the role/UserCenter/createdBy migration, also enforce
      // SUPER_ADMIN vs ADMIN scoping + center-ownership 403 for admin APIs.
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
    const isLoginRoute = rest === 'login' || rest.startsWith('login/');
    // TODO(B7): swap session-presence for a real SUPER_ADMIN/ADMIN role check
    // and center scoping; ADMIN may only reach events where createdBy = their id.
    if (!user && !isLoginRoute) {
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
