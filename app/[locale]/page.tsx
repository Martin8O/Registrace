import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import LanguageSwitcher from '@/components/shared/LanguageSwitcher'
import { mockEvents } from '@/lib/mock/events'

function formatDateRange(startDate: string, endDate: string): string {
  const fmt = (iso: string): string => {
    const parts = iso.split('-')
    const y = parts[0] ?? ''
    const m = parts[1] ?? ''
    const d = parts[2] ?? ''
    return `${d}.${m}.${y}`
  }
  return `${fmt(startDate)}–${fmt(endDate)}`
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('home')

  const publishedEvents = mockEvents.filter((e) => e.status === 'PUBLISHED')

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('heading')}</h1>
          <p className="mt-1 text-gray-500 text-sm">{t('subheading')}</p>
        </div>
        <LanguageSwitcher />
      </div>

      <ul className="space-y-4">
        {publishedEvents.map((event) => {
          const title = locale === 'cs' ? event.title_cs : event.title_en
          const subtitle = locale === 'cs' ? event.subtitle_cs : event.subtitle_en
          const dateRange = formatDateRange(event.startDate, event.endDate)

          return (
            <li key={event.id}>
              <Link
                href={`/${locale}/events/${event.id}`}
                className="block p-4 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <div className="font-medium text-gray-900">{title}</div>
                {subtitle !== null && (
                  <div className="text-sm text-gray-500 mt-0.5">{subtitle}</div>
                )}
                <div className="text-xs text-gray-400 mt-1">{dateRange}</div>
              </Link>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
