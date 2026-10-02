import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { ogLocales } from '@/lib/metadata/openGraph';

// Site-level metadata, in the language of the URL. Everything a page does not
// override is inherited from here, so an unshared page (the homepage, the admin
// panel) still previews as a named card rather than as "Registrace".
//
// `title.template` gives every child page "⟨page⟩ · Registrace na akce BDC" in the
// browser tab; `title.default` is what a page without its own title gets.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'meta' });
  const siteName = t('siteName');
  const description = t('description');
  const { locale: ogLocale, alternateLocale } = ogLocales(locale);

  return {
    title: { default: siteName, template: `%s · ${siteName}` },
    description,
    openGraph: {
      type: 'website',
      siteName,
      title: siteName,
      description,
      locale: ogLocale,
      alternateLocale,
      url: `/${locale}`,
    },
    // X, Slack and several others read the twitter card in preference to OG.
    twitter: { card: 'summary_large_image', title: siteName, description },
  };
}

// Locale layout is now *only* the i18n provider. The public chrome (sticky
// crimson header + LanguageSwitcher + <main>) moved to (public)/layout.tsx so it
// no longer bleeds onto the admin panel, which lives under the same [locale]
// segment but in its own (panel) shell. Route groups are URL-invisible, so all
// public URLs (/[locale], /[locale]/events/[id]) are unchanged.
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // proxy.ts skips every path containing a dot, so `/robots.txt` or `/a.b/admin`
  // arrives here with that string as the locale — unrouted, unauthenticated and
  // without a CSP. Nothing under an unknown locale is a page.
  if (!hasLocale(routing.locales, locale)) notFound();
  // The admin help texts stay on the server: the public site never uses them,
  // and the admin panel layout hands its client components the short "?" hints
  // it needs (the long help page is a Server Component).
  const messages = { ...(await getMessages()) };
  delete messages.help;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
