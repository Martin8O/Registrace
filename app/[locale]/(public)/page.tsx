import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getPublishedEvents } from '@/modules/events'
import { formatDateRangeShort } from '@/lib/utils/formatDate'

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('home')

  const publishedEvents = await getPublishedEvents()

  return (
    <div className="max-w-public mx-auto px-5 md:px-8 pt-4 md:pt-6 pb-10 md:pb-14">
      <div className="mb-10">
        <h1 className="font-serif text-4xl md:text-5xl font-semibold text-neutral-900 leading-tight">
          {t('heading')}
        </h1>
        <div className="h-0.5 w-12 bg-primary-500 mt-3 rounded" />
        <p className="mt-4 text-neutral-500">{t('subheading')}</p>
      </div>

      <ul className="space-y-5">
        {publishedEvents.map((event) => {
          const title = locale === 'cs' ? event.title_cs : event.title_en
          const subtitle = locale === 'cs' ? event.subtitle_cs : event.subtitle_en
          const centerName = locale === 'cs' ? event.center.name_cs : event.center.name_en
          const dateRange = formatDateRangeShort(event.startDate, event.endDate)

          return (
            <li key={event.id}>
              <div className="section-card">
                <Link
                  href={`/${locale}/events/${event.id}`}
                  className="font-serif text-2xl font-semibold text-neutral-900 hover:text-primary-600 transition"
                >
                  {centerName} — {title}
                  <span className="ml-2.5">{dateRange}</span>
                </Link>
                <div className="h-0.5 w-10 bg-primary-500 mt-2 rounded" />

                {subtitle !== null && (
                  <p className="mt-3 text-neutral-600">{subtitle}</p>
                )}

                <div className="mt-5">
                  <Link
                    href={`/${locale}/events/${event.id}`}
                    className="btn-primary inline-block"
                  >
                    {t('openRegistration')}
                  </Link>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
