import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { mockEvents } from '@/lib/mock/events'
import EventStepper, { type EventStepperInitial } from '@/components/admin/EventStepper'
import { getCentersForSelect } from '@/modules/events'

// Edit reuses the create stepper, pre-filled from the mock event. Edit/PUT
// persistence is DEFERRED (a later phase) — the stepper runs in mode="edit"
// (validate-only, no POST). Loading from the DB + enforcing ADMIN-owns-event
// also lands then. (The mock centerId won't match a real DB centre id; harmless
// while edit is validate-only.)
export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const event = mockEvents.find((e) => e.id === id)
  if (!event) notFound()

  const t = await getTranslations('admin.eventForm')
  const centers = await getCentersForSelect()

  const initial: EventStepperInitial = {
    centerId: event.centerId,
    title_cs: event.title_cs,
    title_en: event.title_en,
    description_cs: event.description_cs,
    description_en: event.description_en,
    startDate: event.startDate,
    endDate: event.endDate,
    status: event.status,
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('editTitle')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
      </header>
      <EventStepper centers={centers} mode="edit" initial={initial} />
    </div>
  )
}
