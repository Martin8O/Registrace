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
