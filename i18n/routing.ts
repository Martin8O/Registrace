import { defineRouting } from 'next-intl/routing';

// The one list of locales. proxy.ts routes by it, and the [locale] layout and
// i18n/request.ts reject anything outside it — the proxy's matcher skips every
// path containing a dot, so a `[locale]` value is NOT guaranteed to have been
// through the proxy (`/a.b/admin/help` reaches the app with locale "a.b").
export const routing = defineRouting({
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
