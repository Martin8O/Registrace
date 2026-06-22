import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import EventStepper, {
  type EventStepperInitial,
  type EventStepperEditData,
} from '@/components/admin/EventStepper'
import { getAdminContext } from '@/modules/auth'
import { getCentersForSelect, getEventForEdit } from '@/modules/events'

// Edit reuses the create stepper, pre-filled from the real (ownership-scoped)
// event. Only scalar fields + status are editable (§0 decision 1); centre,
// dates, pricing and meals render read-only. An ADMIN that doesn't own the event
// gets notFound() (which also avoids confirming the event exists).
export default async function EditEventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)

  const event = await getEventForEdit(id, ctx)
  if (!event) notFound()

  const t = await getTranslations('admin.eventForm')
  const centers = await getCentersForSelect()

  const initial: EventStepperInitial = {
    centerId: event.centerId,
    title_cs: event.title_cs,
    title_en: event.title_en,
    description_cs: event.description_cs ?? '',
    description_en: event.description_en ?? '',
    contactName: event.contactName ?? '',
    contactPhone: event.contactPhone ?? '',
    contactEmail: event.contactEmail ?? '',
    startDate: event.startDate,
    endDate: event.endDate,
    maxRegistrations: event.maxRegistrations ?? undefined,
    status: event.status,
  }

  const editData: EventStepperEditData = {
    id: event.id,
    dates: event.dates,
    meals: event.meals,
    pricingRules: event.pricingRules,
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('editTitle')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
      </header>
      <EventStepper centers={centers} mode="edit" initial={initial} editData={editData} />
    </div>
  )
}
