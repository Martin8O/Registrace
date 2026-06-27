import { notFound } from 'next/navigation'
import PricingInfoButton from '@/components/public/PricingInfoButton'
import RegistrationForm from '@/components/public/RegistrationForm'
import { getCentersForSelect, getPublicEventForDetail } from '@/modules/events'
import { formatDateRangeShort } from '@/lib/utils/formatDate'

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params

  // PUBLIC read: only publicly-visible events resolve here (P1 audit H1).
  // DRAFT / past events 404 instead of leaking detail + contact PII.
  const event = await getPublicEventForDetail(id)
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

      <div className="mt-4 flex items-center justify-end">
        <PricingInfoButton meals={event.meals} pricingRules={event.pricingRules} />
      </div>

      <RegistrationForm
        eventId={event.id}
        dates={event.dates}
        meals={event.meals}
        centers={centers}
        pricingRules={event.pricingRules}
      />
    </div>
  )
}
