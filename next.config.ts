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

// The ONE exception to `Cross-Origin-Resource-Policy: same-origin` above. A link
// preview image exists to be displayed on somebody else's page: most chat clients
// scrape and re-host it server-side (CORP is a browser rule and does not apply
// there), but a web client that embeds our URL directly in an <img> would have
// the browser drop it — a card with a blank image, and no error anywhere. The
// card carries only what the public event page already shows, so opting exactly
// this path out costs nothing. Declared after the blanket rule so it wins.
const ogImageHeaders = [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Next does NOT serve the route at a bare `/opengraph-image`: it appends a
      // build-stable hash to the segment (`/cs/events/<id>/opengraph-image-ctd843`),
      // so the pattern has to allow the suffix. Matching the bare name looked
      // right, built cleanly and silently never fired.
      { source: '/:path*/:og(opengraph-image.*)', headers: ogImageHeaders },
    ];
  },
  // `assets/CrimsonPro-SemiBold.ttf` is read at runtime by the OG card (Satori
  // cannot use the app's next/font faces). The build's tracer DOES pick it up on
  // its own today — checked in the route's .nft.json, with and without this
  // entry — but only because the path is two string literals it can fold. Naming
  // the directory outright makes the deployed function carry the font regardless,
  // so the card cannot lose its serif in production only.
  outputFileTracingIncludes: {
    '/**/opengraph-image*': ['./assets/**'],
  },
};

export default withNextIntl(nextConfig);
