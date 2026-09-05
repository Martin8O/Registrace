import type { Metadata } from 'next';
import { Crimson_Pro, Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const crimsonPro = Crimson_Pro({
  subsets: ['latin', 'latin-ext'], // latin-ext required for Czech diacritics
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin', 'latin-ext'], // latin-ext required for Czech diacritics
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

// The origin every absolute URL in the metadata is built from. Without a
// metadataBase Next emits RELATIVE og:image / og:url values and warns at build —
// and a relative og:image previews as no image at all, which is the failure this
// milestone exists to fix.
//
// It reuses NEXT_PUBLIC_APP_URL rather than introducing a second "site URL"
// variable: that one is already REQUIRED (the admin CSRF check 403s every write
// when it is wrong), so it is the one value that is guaranteed to be set and kept
// correct per environment. A second variable for the same origin could only ever
// drift out of step with it. The fallback is the production origin, so a preview
// build with the variable unset still points at a machine that exists.
const SITE_ORIGIN = 'https://registrace.online';

function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return SITE_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return SITE_ORIGIN;
  }
}

// Only the origin lives here. Title, description, Open Graph and Twitter are
// language-dependent, so they are built in the [locale] layout where the locale
// is a route parameter rather than a header.
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = (await headers()).get('X-NEXT-INTL-LOCALE') ?? 'cs';
  return (
    <html
      lang={locale}
      className={`${crimsonPro.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
