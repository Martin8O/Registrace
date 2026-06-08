import { getTranslations } from 'next-intl/server'
import EventStepper from '@/components/admin/EventStepper'

// 7-step event create form. Validates the scalar fields with eventCreateSchema
// on the final step and shows success — it does NOT POST or persist in B6.
export default async function NewEventPage() {
  const t = await getTranslations('admin.eventForm')

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('newTitle')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
      </header>
      <EventStepper />
    </div>
  )
}
