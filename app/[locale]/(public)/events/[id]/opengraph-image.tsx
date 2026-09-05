import { getTranslations } from 'next-intl/server'
import { getPublicEventForDetail } from '@/modules/events'
import { formatDateRangeShort } from '@/lib/utils/formatDate'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card'

export const alt = 'Registrace na akce BDC'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

// The image is its OWN request — a second read, made by a crawler with no
// cookies, minutes or days after the page was fetched. It therefore repeats the
// visibility gate rather than trusting that the page already passed one: an
// image is where a DRAFT event's name would be hardest to notice leaking, and
// impossible to retract once a chat client has cached it.
//
// Dynamic for the same reason: a statically generated image would freeze
// whichever answer the gate gave at build time, so an event published afterwards
// would keep previewing as the neutral card for ever.
export const dynamic = 'force-dynamic'

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  const event = await getPublicEventForDetail(id)

  // Not public → the neutral site card, the same one the metadata falls back to.
  if (!event) {
    return renderOgCard({
      title: t('siteName'),
      footnote: t('description'),
      siteName: 'registrace.online',
    })
  }

  const pick = (cs: string, en: string): string => {
    const preferred = locale === 'en' ? en : cs
    return preferred.trim() ? preferred : locale === 'en' ? cs : en
  }

  return renderOgCard({
    eyebrow: pick(event.center.name_cs, event.center.name_en),
    title: pick(event.title_cs, event.title_en),
    footnote: formatDateRangeShort(event.startDate, event.endDate),
    siteName: 'registrace.online',
  })
}
