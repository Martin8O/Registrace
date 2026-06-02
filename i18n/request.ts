import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? 'cs';
  return {
    locale,
    messages: (await import(`../locales/${locale}.json`)).default as Record<string, string>,
  };
});
