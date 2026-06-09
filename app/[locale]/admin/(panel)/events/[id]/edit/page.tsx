import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { mockEvents } from '@/lib/mock/events'
import EventStepper, { type EventStepperInitial } from '@/components/admin/EventStepper'

// Edit reuses the create stepper, pre-filled from the mock event. Validate-only
// in B6 (no persistence) — only DRAFT/PUBLISHED events are linked here from the
// list. TODO(B7): load from DB and enforce that ADMIN may edit only their own
// events (Event.createdBy = session.user.id).
export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const event = mockEvents.find((e) => e.id === id)
  if (!event) notFound()

  const t = await getTranslations('admin.eventForm')

  const initial: EventStepperInitial = {
    centerId: event.centerId,
    title_cs: event.title_cs,
    title_en: event.title_en,
    // The event form's "Popis / Description" is bound to subtitle_* (frozen
    // schema); pre-fill it from the event's description text.
    subtitle_cs: event.description_cs,
    subtitle_en: event.description_en,
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
      <EventStepper initial={initial} />
    </div>
  )
}
