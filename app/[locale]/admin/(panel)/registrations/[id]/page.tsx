'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { mockEvents } from '@/lib/mock/events'
import {
  mockCenters,
  mockEventDates,
  mockMealSlots,
} from '@/lib/mock/registrationOptions'
import {
  mockRegistrations,
  type MockRegistrationStatus,
} from '@/lib/mock/registrations'
import { RegStatusBadge } from '@/components/admin/StatusBadge'

const REG_STATUSES: MockRegistrationStatus[] = ['REGISTERED', 'CANCELLED']

export default function RegistrationDetailPage() {
  const params = useParams()
  const locale = useLocale()
  const t = useTranslations('admin')
  const base = `/${locale}/admin`

  const id = Array.isArray(params.id) ? params.id[0] : params.id
  const registration = mockRegistrations.find((r) => r.id === id)

  // Editable copies (center / accommodation / status). Save is a no-op in B6.
  const [centerId, setCenterId] = useState(registration?.centerId ?? '')
  const [hasAccommodation, setHasAccommodation] = useState(
    registration?.hasAccommodation ?? false,
  )
  const [status, setStatus] = useState<MockRegistrationStatus>(
    registration?.status ?? 'REGISTERED',
  )
  const [toast, setToast] = useState<string | null>(null)

  if (!registration) {
    return (
      <div className="section-card">
        <p className="text-neutral-700">{t('registrationDetail.notFound')}</p>
        <Link
          href={`${base}/registrations`}
          className="mt-4 inline-block text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          ← {t('registrations.title')}
        </Link>
      </div>
    )
  }

  const event = mockEvents.find((e) => e.id === registration.eventId)
  const eventTitle = event
    ? `${event.center.name} — ${locale === 'cs' ? event.title_cs : event.title_en}`
    : registration.eventId

  const dateLabel = (dateId: string) => {
    const d = mockEventDates.find((d) => d.id === dateId)
    if (!d) return dateId
    return locale === 'cs' ? d.label_cs : d.label_en
  }

  // A booked meal → "day · meal type" (e.g. "Sobota 5. 9. · Snídaně").
  const mealLabel = (mealId: string): string | null => {
    const slot = mockMealSlots.find((s) => s.id === mealId)
    if (!slot) return null
    const day = mockEventDates.find((d) => d.id === slot.eventDateId)
    const dayLabel = day ? (locale === 'cs' ? day.label_cs : day.label_en) : ''
    return `${dayLabel} · ${t(`mealType.${slot.mealType}`)}`
  }

  // TODO(B7): real PUT /api/admin/registrations/[id] + resend-confirmation.
  const handleSave = () => setToast(t('registrationDetail.saved'))
  const handleResend = () => setToast(t('registrationDetail.resent'))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('registrationDetail.title')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
          <p className="mt-2 font-mono text-sm text-neutral-500">{registration.id}</p>
        </div>
        <Link
          href={`${base}/registrations`}
          className="text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          ← {t('registrations.title')}
        </Link>
      </header>

      {toast && (
        <div className="rounded-lg border border-success-500/40 bg-success-50 p-3 text-sm text-success-700">
          {toast}
        </div>
      )}

      {/* Read-only summary + editable center / accommodation / status */}
      <section className="section-card space-y-5">
        <ReadOnlyRow label={t('registrationDetail.email')} value={registration.email} />
        <ReadOnlyRow label={t('registrationDetail.event')} value={eventTitle} />
        <ReadOnlyRow
          label={t('registrationDetail.arrival')}
          value={`${dateLabel(registration.arrivalDateId)} - ${t(`arrivalTime.${registration.arrivalTime}`).toLowerCase()}`}
        />
        <ReadOnlyRow
          label={t('registrationDetail.departure')}
          value={`${dateLabel(registration.departureDateId)} - ${(registration.earlyDeparture === 'AFTER_BREAKFAST'
            ? t('registrationDetail.afterBreakfast')
            : t('registrationDetail.untilEnd')
          ).toLowerCase()}`}
        />

        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
          <div>
            <label htmlFor="center" className="form-label">
              {t('registrationDetail.homeCenter')}
            </label>
            <select
              id="center"
              className="bdc-input"
              value={centerId}
              onChange={(e) => setCenterId(e.target.value)}
            >
              {mockCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'cs' ? c.name_cs : c.name_en}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="form-label">{t('registrationDetail.accommodation')}</span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: true, key: 'yes' },
                { value: false, key: 'no' },
              ].map((opt) => {
                const active = hasAccommodation === opt.value
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setHasAccommodation(opt.value)}
                    className={`rounded-lg border px-3.5 py-2 text-sm transition ${
                      active
                        ? 'border-primary-500 bg-primary-50 font-medium text-primary-700'
                        : 'border-neutral-300 text-neutral-700 hover:border-neutral-400'
                    }`}
                  >
                    {t(`common.${opt.key}`)}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label htmlFor="status" className="form-label">
              {t('registrationDetail.status')}
            </label>
            <div className="flex items-center gap-3">
              <select
                id="status"
                className="bdc-input"
                value={status}
                onChange={(e) => setStatus(e.target.value as MockRegistrationStatus)}
              >
                {REG_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`regStatus.${s}`)}
                  </option>
                ))}
              </select>
              <RegStatusBadge status={status} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={handleSave} className="btn-primary">
            {t('registrationDetail.save')}
          </button>
          <button type="button" onClick={handleResend} className="btn-secondary">
            {t('registrationDetail.resend')}
          </button>
        </div>
      </section>

      {/* Participants (read-only) — incl. each person's booked meals */}
      <section className="section-card">
        <h2 className="mb-4 font-serif text-xl font-semibold text-neutral-900">
          {t('registrationDetail.participants')}
        </h2>
        <div className="space-y-4">
          {registration.participants.map((p, i) => {
            const meals = p.mealIds
              .map(mealLabel)
              .filter((m): m is string => m !== null)
            return (
              <div
                key={i}
                className={`participant-card ${i % 2 === 1 ? 'bg-gold-50' : ''}`}
              >
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
