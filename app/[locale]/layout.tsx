import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
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
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
