import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import LanguageSwitcher from '@/components/shared/LanguageSwitcher'
import PricingInfoButton from '@/components/public/PricingInfoButton'
import { mockEvents } from '@/lib/mock/events'

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations('event')

  const event = mockEvents.find((e) => e.id === id)
  if (!event) notFound()

  const title = locale === 'cs' ? event.title_cs : event.title_en
  const subtitle = locale === 'cs' ? event.subtitle_cs : event.subtitle_en

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-start justify-between mb-8">
        <div />
        <LanguageSwitcher />
      </div>

      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      {subtitle !== null && (
        <p className="mt-2 text-gray-500">{subtitle}</p>
      )}

      <div className="mt-4">
        <PricingInfoButton />
      </div>

      <div className="mt-8 text-gray-500">{t('registrationFormPlaceholder')}</div>
    </main>
  )
}
