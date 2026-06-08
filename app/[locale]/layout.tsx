import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

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
