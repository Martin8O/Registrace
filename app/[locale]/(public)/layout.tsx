import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';

// Public chrome — moved out of the locale layout in B6 so it does not wrap the
// admin panel. Visually identical to the pre-B6 public site: sticky crimson
// header with the BDC logo, the CZ/EN switcher row beneath the rule, and the
// page content inside <main className="min-h-screen">. The Home link (top
// left) is the public site's only navigation back to the event list — e.g.
// after the registration form's success state replaces the page content.
export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations('home');

  return (
    <>
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
      {/* Home link + CZ/EN toggle — below the logo, beneath the crimson rule.
          max-w-public matches the page content so the Home icon lines up with the
          left edge of the page heading; CZ/EN stays at the right. w-full is required
          because this div is a direct flex-item of the body's flex-col; without it,
          mx-auto suppresses stretch and the row collapses. */}
      <div className="w-full max-w-public mx-auto px-5 md:px-8 mt-4 flex items-center justify-between">
        <Link
          href={`/${locale}`}
          aria-label={t('homeButton')}
          title={t('homeButton')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-primary-600 transition hover:bg-primary-500/10 hover:text-primary-700"
        >
          <HomeIcon />
        </Link>
        <LanguageSwitcher />
      </div>
      <main className="min-h-screen">{children}</main>
    </>
  );
}

// House icon (inline SVG — no icon library dependency).
function HomeIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  );
}
