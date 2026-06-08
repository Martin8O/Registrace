import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';

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
      <header className="sticky top-0 z-40 border-b-2 border-primary-500/90 bg-white">
        <div className="max-w-admin mx-auto px-5 md:px-8 h-[72px] flex items-center justify-end">
          {/* Logo at far right — the JPEG's near-white (#F9F9F9) background reads as a faint
              gray box on the pure-white header; brightness() lifts it to true white, and
              multiply keeps that white acting as transparent on any non-white surface. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/bdc_logo_2.jpg"
            alt="Buddhismus Diamantové cesty"
            className="h-10 md:h-11 w-auto shrink-0"
            style={{ mixBlendMode: 'multiply', filter: 'brightness(1.05)' }}
          />
        </div>
      </header>
      {/* CZ/EN language toggle — below the logo, beneath the crimson rule.
          w-full is required because this div is a direct flex-item of the body's
          flex-col; without it, mx-auto suppresses stretch and the row collapses. */}
      <div className="w-full max-w-admin mx-auto px-5 md:px-8 mt-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <main className="min-h-screen">{children}</main>
    </NextIntlClientProvider>
  );
}
