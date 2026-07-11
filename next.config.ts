import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// Content-Security-Policy is NOT set here anymore — it moved to proxy.ts
// (middleware) so production can use a PER-REQUEST nonce and drop 'unsafe-inline'
// from script-src (a static config header can't carry a per-request nonce). Only
// the request-independent security headers stay here (applied to every response
// via `source: '/:path*'`); CSP is applied per page response in the middleware.
const securityHeaders = [
  // HSTS — only meaningful over HTTPS; harmless on localhost (browsers ignore it
  // on http). Vercel serves HTTPS, so this is live in production. `preload` opts
  // the domain into the browser HSTS preload list — ONE-WAY: the apex + every
  // subdomain (send.*, www.*) must serve HTTPS forever. Safe here (all HTTPS on
  // Vercel; mail on send.* uses SMTP, which HSTS doesn't touch). Header alone does
  // nothing until the domain is submitted at https://hstspreload.org/.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // CORP — MDN/Hardenize flag its absence (defaults to cross-origin). This app
  // serves no assets meant for cross-origin embedding, so lock resources to our
  // own origin.
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
