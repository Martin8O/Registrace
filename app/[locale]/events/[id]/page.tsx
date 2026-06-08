import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import PricingInfoButton from '@/components/public/PricingInfoButton'
import RegistrationForm from '@/components/public/RegistrationForm'
import { mockEvents, type MockEvent } from '@/lib/mock/events'
import { mockCenters, mockEventDates, mockMealSlots } from '@/lib/mock/registrationOptions'

const badgeVariants: Record<MockEvent['status'], string> = {
  PUBLISHED: 'bg-gold-100 text-gold-800 border border-gold-300',
  DRAFT: 'bg-muted-bg text-muted-fg border border-muted-border',
  CLOSED: 'bg-neutral-200 text-neutral-600 border border-neutral-300',
  ARCHIVED: 'bg-neutral-200 text-neutral-600 border border-neutral-300',
}

const badgeLabelKey: Record<MockEvent['status'], string> = {
  PUBLISHED: 'published',
  DRAFT: 'draft',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
}

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

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const tBadge = await getTranslations('badge')

  const event = mockEvents.find((e) => e.id === id)
  if (!event) notFound()

  const title = locale === 'cs' ? event.title_cs : event.title_en
  const description = locale === 'cs' ? event.description_cs : event.description_en
  const dateRange = formatDateRange(event.startDate, event.endDate)

  return (
    <div className="max-w-public mx-auto px-5 md:px-8 pt-4 md:pt-6 pb-10 md:pb-14">
      <h1 className="font-serif text-2xl md:text-3xl font-semibold text-neutral-900 leading-snug">
        {event.center.name} — {title} — {dateRange}
      </h1>
      <div className="h-0.5 w-12 bg-primary-500 mt-3 rounded" />

      <p className="mt-4 text-neutral-600 leading-relaxed">{description}</p>

      <div className="mt-4">
        <span className={`badge ${badgeVariants[event.status]}`}>
          {tBadge(badgeLabelKey[event.status])}
        </span>
      </div>

      <div className="mt-6">
        <PricingInfoButton />
      </div>

      <RegistrationForm
        eventId={event.id}
        dates={mockEventDates}
        meals={mockMealSlots}
        centers={mockCenters}
      />
    </div>
  )
}
