import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

// The admin help (`help`: the /admin/help page and the "?" hints) exists in
// Czech only — a deliberate product decision, not a missing translation. It
// lives in cs.json alone and is grafted onto every locale here, so an English
// admin reads the same Czech help instead of a missing-key fallback.
export default getRequestConfig(async ({ requestLocale }) => {
  // A `[locale]` segment the proxy never saw (any path with a dot skips it) can
  // be anything; never let it choose which file is imported.
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = (await import(`../locales/${locale}.json`)).default as Record<string, unknown>;
  const cs = (await import('../locales/cs.json')).default as Record<string, unknown>;
  return {
    locale,
    messages: { ...messages, help: cs.help } as Record<string, string>,
  };
});
