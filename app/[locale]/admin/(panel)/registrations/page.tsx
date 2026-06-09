'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
import { computeMealStats } from '@/lib/utils/mealStats'
import { RegStatusBadge } from '@/components/admin/StatusBadge'

const REG_STATUSES: MockRegistrationStatus[] = ['REGISTERED', 'CANCELLED']

function formatDate(iso: string): string {
  const [date = ''] = iso.split('T')
  const [year = '', month = '', day = ''] = date.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

function RegistrationsTable() {
  const t = useTranslations('admin')
  const locale = useLocale()
  const base = `/${locale}/admin`
  const searchParams = useSearchParams()

  // Event scope comes from the Akce page ("Registrace" link → ?event=<id>).
  const eventId = searchParams.get('event')
  const scopedEvent = eventId
    ? mockEvents.find((e) => e.id === eventId)
    : undefined

  // Meals to cook for the selected event (per day, REGISTERED participants only).
  const mealStats = eventId
    ? computeMealStats(
        mockRegistrations.filter((r) => r.eventId === eventId),
        mockEventDates,
        mockMealSlots,
      )
    : []
  // Only surface the panel when there is actually something to cook (avoids an
  // all-zero panel for events that have no meal data in the mock).
  const hasMealData = mealStats.some((d) => d.meals.some((m) => m.count > 0))

  // Visible filters: event centre + status (event scope is separate, via URL).
  const [centerFilter, setCenterFilter] = useState<'ALL' | string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | MockRegistrationStatus>('ALL')

  // A registration's centre = the centre hosting its event (NOT the registrant's
  // home centre). Map event → centre id once, then derive per registration.
  const eventById = new Map(mockEvents.map((e) => [e.id, e]))
  const eventCenterId = (r: { eventId: string }) =>
    eventById.get(r.eventId)?.centerId ?? ''

  const centerName = (id: string) => {
    const c = mockCenters.find((c) => c.id === id)
    if (!c) return id
    return locale === 'cs' ? c.name_cs : c.name_en
  }

  // Filter options = the distinct event centres that actually have registrations.
  const filterCenters = [...new Set(mockRegistrations.map(eventCenterId))]
    .filter(Boolean)
    .map((id) => mockCenters.find((c) => c.id === id))
    .filter((c): c is (typeof mockCenters)[number] => Boolean(c))
    .sort((a, b) => a.name_cs.localeCompare(b.name_cs, 'cs'))

  const rows = mockRegistrations.filter(
    (r) =>
      (!eventId || r.eventId === eventId) &&
      // Centre filter applies only on a direct visit; when scoped to an event
      // (Events → Registrace) the centre is already fixed, so it's ignored.
      (!!eventId || centerFilter === 'ALL' || eventCenterId(r) === centerFilter) &&
      (statusFilter === 'ALL' || r.status === statusFilter),
  )

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('registrations.title')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
      </header>

      {scopedEvent && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm">
          <span className="text-gold-800">
            {t('registrations.showingEvent', {
              event: `${scopedEvent.center.name} — ${locale === 'cs' ? scopedEvent.title_cs : scopedEvent.title_en}`,
            })}
          </span>
          <Link
            href={`${base}/registrations`}
            className="font-medium text-primary-600 hover:text-primary-700"
          >
            {t('registrations.clearEvent')}
          </Link>
        </div>
      )}

      {scopedEvent && hasMealData && (
        <div className="section-card mb-5">
          <h2 className="font-serif text-lg font-semibold text-neutral-900">
            {t('registrations.mealStatsTitle')}
          </h2>
          <div className="mt-3 space-y-2">
            {mealStats.map((day) => (
              <div
                key={day.dateId}
                className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"
              >
                <span className="min-w-[130px] font-medium text-neutral-800">
                  {locale === 'cs' ? day.label_cs : day.label_en}
                </span>
                <span className="flex flex-wrap gap-x-5 gap-y-1 text-neutral-600">
                  {day.meals.map((m) => (
                    <span key={m.mealType}>
                      <span className="font-mono font-semibold tabular-nums text-primary-600">
                        {m.count}×
                      </span>{' '}
                      {t(`mealType.${m.mealType}`)}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-4">
        {/* Centre filter is only useful on a direct visit — when scoped to one
            event (Events → Registrace) the centre is already determined. */}
        {!eventId && (
          <div className="flex items-center gap-2">
            <label htmlFor="centerFilter" className="text-sm font-medium text-neutral-600">
              {t('registrations.filterCenter')}
            </label>
            <select
              id="centerFilter"
              className="bdc-input w-auto"
              value={centerFilter}
              onChange={(e) => setCenterFilter(e.target.value)}
            >
              <option value="ALL">{t('registrations.allCenters')}</option>
              {filterCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'cs' ? c.name_cs : c.name_en}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor="statusFilter" className="text-sm font-medium text-neutral-600">
            {t('registrations.filterStatus')}
          </label>
          <select
            id="statusFilter"
            className="bdc-input w-auto"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'ALL' | MockRegistrationStatus)
            }
          >
            <option value="ALL">{t('common.all')}</option>
            {REG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`regStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="section-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="px-4 py-3 font-medium">{t('registrations.table.id')}</th>
              <th className="px-4 py-3 font-medium">{t('registrations.table.email')}</th>
              <th className="px-4 py-3 font-medium">{t('registrations.table.center')}</th>
              <th className="px-4 py-3 font-medium">{t('registrations.table.date')}</th>
              <th className="px-4 py-3 text-right font-medium">
                {t('registrations.table.participants')}
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {t('registrations.table.total')}
              </th>
              <th className="px-4 py-3 font-medium">{t('registrations.table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                  {t('registrations.empty')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-stone-50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`${base}/registrations/${r.id}`}
                      className="font-medium text-primary-600 hover:text-primary-700"
                    >
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{r.email}</td>
                  <td className="px-4 py-3 text-neutral-700">
                    {centerName(eventCenterId(r))}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-neutral-600">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                    {r.participants.length}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-900">
                    {r.totalPrice} CZK
                  </td>
                  <td className="px-4 py-3">
                    <RegStatusBadge status={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminRegistrationsPage() {
  // useSearchParams needs a Suspense boundary for static prerender.
  return (
    <Suspense>
      <RegistrationsTable />
    </Suspense>
  )
}
