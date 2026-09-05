import { getTranslations } from 'next-intl/server'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card'

// The site's own card — what the homepage previews with, and what any page that
// does not override it inherits. `alt` must be a static export, so it carries the
// Czech name for both locales rather than pretending to be language-aware.
export const alt = 'Registrace na akce BDC'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  return renderOgCard({
    title: t('siteName'),
    footnote: t('description'),
    siteName: 'registrace.online',
  })
}
