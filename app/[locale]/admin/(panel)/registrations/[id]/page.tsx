import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getAdminContext } from '@/modules/auth'
import { getRegistrationForDetail } from '@/modules/registrations'
import { getCentersForSelect } from '@/modules/events'
import RegistrationDetailEditor from '@/components/admin/RegistrationDetailEditor'

// Server component: loads one registration (ownership-scoped → notFound for a
// missing / not-owned id), renders the read-only summary + participants, and
// hands the editable fields (centre / accommodation / status + save / resend) to
// a client island.
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
  const arrivalLabel = lang === 'cs' ? detail.arrivalLabel_cs : detail.arrivalLabel_en
  const departureLabel = lang === 'cs' ? detail.departureLabel_cs : detail.departureLabel_en

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

      {/* Prominent, centered registration number */}
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          {t('registrationDetail.number')}
        </p>
        <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-neutral-900">
          {detail.registrationNumber ?? detail.id}
        </p>
      </div>

      {/* Read-only summary */}
      <section className="section-card space-y-5">
        <ReadOnlyRow label={t('registrationDetail.email')} value={detail.email} />
        <ReadOnlyRow label={t('registrationDetail.event')} value={eventTitle} />
        <ReadOnlyRow
          label={t('registrationDetail.arrival')}
          value={`${arrivalLabel} - ${t(`arrivalTime.${detail.arrivalTime}`).toLowerCase()}`}
        />
        <ReadOnlyRow
          label={t('registrationDetail.departure')}
          value={`${departureLabel} - ${(detail.earlyDeparture === 'AFTER_BREAKFAST'
            ? t('registrationDetail.afterBreakfast')
            : t('registrationDetail.untilEnd')
          ).toLowerCase()}`}
        />
      </section>

      {/* Editable center / accommodation / status + save / resend */}
      <RegistrationDetailEditor
        registrationId={detail.id}
        centers={centers}
        initialCenterId={detail.centerId}
        initialHasAccommodation={detail.hasAccommodation}
        initialStatus={detail.status}
      />

      {/* Participants (read-only) — incl. each person's booked meals */}
      <section className="section-card">
        <h2 className="mb-4 font-serif text-xl font-semibold text-neutral-900">
          {t('registrationDetail.participants')}
        </h2>
        <div className="space-y-4">
          {detail.participants.map((p, i) => {
            const meals = p.meals.map((m) => (lang === 'cs' ? m.label_cs : m.label_en))
            return (
              <div key={i} className={`participant-card ${i % 2 === 1 ? 'bg-gold-50' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-neutral-900">{p.fullName}</p>
                  <p className="font-mono text-sm tabular-nums text-neutral-900">
                    {p.totalPrice} CZK
                  </p>
                </div>
                <p className="mt-1 text-sm text-neutral-600">
                  {t(`age.${p.ageCategory}`)}
                  {p.pricingType && ` · ${t(`pricingType.${p.pricingType}`)}`}
                </p>
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {t('registrationDetail.meals')}
                  </p>
                  {meals.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {meals.map((m, j) => (
                        <span
                          key={j}
                          className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-neutral-400">—</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-neutral-100 pb-3 last:border-0">
      <span className="text-sm font-medium text-neutral-500">{label}</span>
      <span className="text-sm text-neutral-900">{value}</span>
    </div>
  )
}
