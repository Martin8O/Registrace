import createMiddleware from 'next-intl/middleware';
import { defineRouting } from 'next-intl/routing';

const routing = defineRouting({
  locales: ['cs', 'en'],
  defaultLocale: 'cs',
});

export const proxy = createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
