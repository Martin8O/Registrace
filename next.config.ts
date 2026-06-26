import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const isDev = process.env.NODE_ENV !== 'production';

// The browser talks DIRECTLY to Supabase Auth (lib/supabase/client.ts uses
// createBrowserClient on the login / logout / profile pages), so connect-src MUST
// allow the Supabase origin — a bare `default-src 'self'` would 403 every auth
// call and break login. We allow the specific project URL from the (build-time
// inlined) env var, with a `*.supabase.co` fallback so the policy can never lock
// auth out if the var is momentarily unset. `wss:` covers Supabase realtime.
const supabaseOrigin = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return 'https://*.supabase.co';
  try {
    return new URL(url).origin;
  } catch {
    return 'https://*.supabase.co';
  }
})();

// Content-Security-Policy (P8). The generic spec was default/script/style only;
// grounded against the real app it also needs connect-src (Supabase), img/font/
// (self-hosted next/font), and the navigation hardening directives. `unsafe-inline`
// on scripts is required by Next's inline bootstrap; `unsafe-eval` + ws: are added
// ONLY in dev so HMR / React Refresh keep working (this header applies in dev too).
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self'`,
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace('https://', 'wss://')}${isDev ? ' ws:' : ''}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // HSTS — only meaningful over HTTPS; harmless on localhost (browsers ignore it
  // on http). Vercel serves HTTPS, so this is live in production.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
