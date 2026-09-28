import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getAdminContext } from '@/modules/auth'
import { getRegistrationForDetail } from '@/modules/registrations'
import { getCentersForSelect } from '@/modules/events'
import RegistrationFullEditor, { type FullEditorData } from '@/components/admin/RegistrationFullEditor'
import PricingInfoButton from '@/components/public/PricingInfoButton'

// Server component: loads one registration (ownership-scoped → notFound for a
// missing / not-owned id), renders the read-only facts (e-mail, event, home
// centre), and hands everything the registrant chose — stay, people, meals — to
// the full editor island (M50b), which re-prices through the server and saves.
export default async function RegistrationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const ctx = await getAdminContext()
  if (!ctx) redirect(`/${locale}/admin/login`)

  const detail = await getRegistrationForDetail(id, ctx)
  if (!detail) notFound()

  const [t, centers] = await Promise.all([
    getTranslations('admin'),
    getCentersForSelect(),
  ])
  const lang = await getLocale()
  const base = `/${locale}/admin`

  const eventTitle = `${lang === 'cs' ? detail.event.centerName_cs : detail.event.centerName_en} — ${lang === 'cs' ? detail.event.title_cs : detail.event.title_en}`
  // The registrant's home centre and e-mail are shown, not edited: admins do not
  // re-home a registrant, and the e-mail is not editable (Martin, 2026-09-28).
  const homeCenter = centers.find((c) => c.id === detail.centerId)
  const homeCenterName = homeCenter
    ? lang === 'cs'
      ? homeCenter.name_cs
      : homeCenter.name_en
    : detail.centerId

  const data: FullEditorData = {
    registrationId: detail.id,
    registrationNumber: detail.registrationNumber ?? detail.id,
    updatedAt: detail.updatedAt,
    centerId: detail.centerId,
    status: detail.status,
    totalPrice: detail.totalPrice,
    hasAccommodation: detail.hasAccommodation,
    arrivalDateId: detail.arrivalDateId,
    arrivalTime: detail.arrivalTime as FullEditorData['arrivalTime'],
    departureDateId: detail.departureDateId,
    earlyDeparture: detail.earlyDeparture as FullEditorData['earlyDeparture'],
    participants: detail.participants.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      ageCategory: p.ageCategory as FullEditorData['participants'][number]['ageCategory'],
      pricingType: p.pricingType as FullEditorData['participants'][number]['pricingType'],
      mealPricingType: p.mealPricingType as FullEditorData['participants'][number]['mealPricingType'],
      mealType: p.mealType as FullEditorData['participants'][number]['mealType'],
      mealIds: p.mealIds,
      totalPrice: p.totalPrice,
    })),
    event: {
      dates: detail.eventDates,
      meals: detail.eventMeals,
      mealPricingRules: detail.eventMealPricingRules,
      participationPricingTypes: detail.eventParticipationPricingTypes,
      mealPricingTypes: detail.eventMealPricingTypes,
      mealDeadline: detail.eventMealDeadline,
    },
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('registrationDetail.title')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        </div>
        <Link
          href={`${base}/registrations`}
          className="text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          ← {t('registrations.title')}
        </Link>
      </header>

      <RegistrationFullEditor
        data={data}
        numberLabel={t('registrationDetail.number')}
        pricingButton={
          <PricingInfoButton
            meals={detail.eventMeals}
            pricingRules={detail.eventPricingRules}
            mealPricingRules={detail.eventMealPricingRules}
            participationPricingTypes={detail.eventParticipationPricingTypes}
            mealPricingTypes={detail.eventMealPricingTypes}
          />
        }
      >
        {/* Read-only facts — the event name links to that event's registrations. */}
        <section className="section-card space-y-5">
          <ReadOnlyRow label={t('registrationDetail.email')} value={detail.email} />
          <ReadOnlyRow
            label={t('registrationDetail.event')}
            value={eventTitle}
            href={`${base}/registrations?event=${detail.event.id}`}
          />
          <ReadOnlyRow label={t('registrationDetail.homeCenter')} value={homeCenterName} />
        </section>
      </RegistrationFullEditor>
    </div>
  )
}

function ReadOnlyRow({
  label,
  value,
  href,
}: {
  label: string
  value: string
  href?: string
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-neutral-100 pb-3 last:border-0">
      <span className="text-sm font-medium text-neutral-500">{label}</span>
      {href ? (
        <Link
          href={href}
          className="text-right text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          {value}
        </Link>
      ) : (
        <span className="text-sm text-neutral-900">{value}</span>
      )}
    </div>
  )
}
