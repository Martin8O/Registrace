import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import EventStepper, {
  type EventStepperInitial,
  type EventStepperEditData,
} from '@/components/admin/EventStepper'
import { getAdminContext } from '@/modules/auth'
import {
  getCentersForAdminSelect,
  getEventForEdit,
  formatPragueDateTimeLocal,
} from '@/modules/events'

// Edit reuses the create stepper, pre-filled from the real (ownership-scoped)
// event. A DRAFT with no registrations is fully editable (centre/dates/pricing/
// meals); otherwise those render read-only and only scalars + status are
// editable (§0 decision 1). An ADMIN that doesn't own the event gets notFound()
// (which also avoids confirming the event exists).
export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ step?: string }>
}) {
  const { locale, id } = await params
  const { step } = await searchParams
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)

  const event = await getEventForEdit(id, ctx)
  if (!event) notFound()

  const t = await getTranslations('admin.eventForm')

  // Scope the (now possibly editable) centre dropdown to what the admin may use.
  const centers = await getCentersForAdminSelect(ctx)
  const canEditRelations = event.status === 'DRAFT' && event.registrationCount === 0
  // Once anyone has registered, a live event cannot go back to draft (the server
  // refuses it too) — so the wizard does not offer it.
  const canUnpublish = event.status === 'DRAFT' || event.registrationCount === 0
  const initialStep = Number(step) >= 0 ? Number(step) : 0

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
    // UTC ISO → Prague wall-clock for the datetime-local input.
    mealRegistrationDeadline: event.mealRegistrationDeadline
      ? formatPragueDateTimeLocal(new Date(event.mealRegistrationDeadline))
      : '',
    status: event.status,
  }

  const editData: EventStepperEditData = {
    id: event.id,
    dates: event.dates,
    meals: event.meals,
    pricingRules: event.pricingRules,
    mealPricingRules: event.mealPricingRules,
    participationPricingTypes: event.participationPricingTypes,
    mealPricingTypes: event.mealPricingTypes,
  }

  // Over (isEventEditable): read-only. The server refuses the write anyway, so
  // no wizard and no save — but the event stays READABLE: this is the only screen
  // in the admin that shows its price list, meal days and settings, and whoever
  // settles payments after the event needs exactly those.
  if (!event.editable) {
    return (
      <div>
        <header className="mb-6">
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('viewTitle')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        </header>
        <section className="section-card mb-6 space-y-4">
          <p className="text-neutral-700">{t('endedNote')}</p>
          <Link
            href={`/${locale}/admin/registrations?event=${event.id}`}
            className="btn-secondary inline-flex"
          >
            {t('endedRegistrations')}
          </Link>
        </section>
        <EventStepper
          centers={centers}
          mode="edit"
          initial={initial}
          editData={editData}
          canEditRelations={false}
          canUnpublish={false}
          readOnly
        />
      </div>
    )
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('editTitle')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
      </header>
      <EventStepper
        centers={centers}
        mode="edit"
        initial={initial}
        editData={editData}
        canEditRelations={canEditRelations}
        canUnpublish={canUnpublish}
        initialStep={initialStep}
      />
    </div>
  )
}
