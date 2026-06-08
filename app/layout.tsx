import type { Metadata } from 'next';
import { Crimson_Pro, Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
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

export const metadata: Metadata = {
  title: 'Registrace',
  description: 'Registrace na akce',
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
