import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import PricingInfoButton from '@/components/public/PricingInfoButton'
import RegistrationForm from '@/components/public/RegistrationForm'
import {
  getCentersForSelect,
  getEventForDetail,
  type EventStatusValue,
} from '@/modules/events'
import { formatDateRangeShort } from '@/lib/utils/formatDate'

const badgeVariants: Record<EventStatusValue, string> = {
  PUBLISHED: 'bg-gold-100 text-gold-800 border border-gold-300',
  DRAFT: 'bg-muted-bg text-muted-fg border border-muted-border',
  CLOSED: 'bg-neutral-200 text-neutral-600 border border-neutral-300',
  ARCHIVED: 'bg-neutral-200 text-neutral-600 border border-neutral-300',
}

const badgeLabelKey: Record<EventStatusValue, string> = {
  PUBLISHED: 'published',
  DRAFT: 'draft',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const tBadge = await getTranslations('badge')

  const event = await getEventForDetail(id)
  if (!event) notFound()

  // The form's centre dropdown is the registrant's home centre — the full
  // active-centre list, not the event's hosting centre (invariant: distinct).
  const centers = await getCentersForSelect()

  const title = locale === 'cs' ? event.title_cs : event.title_en
  const description = locale === 'cs' ? event.description_cs : event.description_en
  const centerName = locale === 'cs' ? event.center.name_cs : event.center.name_en
  const dateRange = formatDateRangeShort(event.startDate, event.endDate)

  return (
    <div className="max-w-public mx-auto px-5 md:px-8 pt-4 md:pt-6 pb-10 md:pb-14">
      <h1 className="font-serif text-2xl md:text-3xl font-semibold text-neutral-900 leading-snug">
        {centerName} — {title}
        <span className="ml-2.5">{dateRange}</span>
      </h1>
      <div className="h-0.5 w-12 bg-primary-500 mt-3 rounded" />

      {description !== null && (
        <p className="mt-4 text-neutral-600 leading-relaxed">{description}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className={`badge ${badgeVariants[event.status]}`}>
          {tBadge(badgeLabelKey[event.status])}
        </span>
        <PricingInfoButton />
      </div>

      <RegistrationForm
        eventId={event.id}
        dates={event.dates}
        meals={event.meals}
        centers={centers}
      />
    </div>
  )
}
