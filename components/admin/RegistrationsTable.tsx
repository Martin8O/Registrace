'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { RegStatusBadge } from '@/components/admin/StatusBadge'
import type {
  AdminRegistrationListItem,
  AdminRegistrationStatus,
  DayMealStat,
} from '@/modules/registrations'

const REG_STATUSES: AdminRegistrationStatus[] = ['REGISTERED', 'PAID', 'CANCELLED']

function formatDate(iso: string): string {
  const [date = ''] = iso.split('T')
  const [year = '', month = '', day = ''] = date.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

// Client island over the server-loaded registration rows. Data + ownership
// scoping are resolved server-side (listRegistrations); meal stats are computed
// server-side too (getEventMealStats) and passed in. This island only owns the
// centre/status filters + the event-scope presentation.
export default function RegistrationsTable({
  rows,
  scopedEventId,
  mealStats,
}: {
  rows: AdminRegistrationListItem[]
  scopedEventId: string | null
  mealStats: DayMealStat[]
}) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const base = `/${locale}/admin`

  const [centerFilter, setCenterFilter] = useState<'ALL' | string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | AdminRegistrationStatus>('ALL')
  // On-site search by registration number (the team types the number to find a
  // registrant). Matches the email too, as a convenience. Already role/ownership
  // scoped server-side, so this only narrows the rows this admin may see.
  const [search, setSearch] = useState('')

  const centerName = (r: AdminRegistrationListItem) =>
    locale === 'cs' ? r.centerName_cs : r.centerName_en

  // Scoped event header (derived from the first matching row).
  const scopedRow = scopedEventId
    ? rows.find((r) => r.eventId === scopedEventId)
    : undefined
  const scopedEventLabel = scopedRow
    ? `${centerName(scopedRow)} — ${locale === 'cs' ? scopedRow.eventTitle_cs : scopedRow.eventTitle_en}`
    : null

  // Only surface the meal panel when there is actually something to cook.
  const hasMealData = mealStats.some((d) => d.meals.some((m) => m.count > 0))

  // Centre filter options = distinct event centres that actually have rows.
  const filterCenters = [
    ...new Map(rows.map((r) => [r.centerId, r])).values(),
  ]
    .map((r) => ({ id: r.centerId, name: centerName(r) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(
    (r) =>
      (!scopedEventId || r.eventId === scopedEventId) &&
      // Centre filter applies only on a direct visit; when scoped to an event the
      // centre is already fixed, so it's ignored.
      (!!scopedEventId || centerFilter === 'ALL' || r.centerId === centerFilter) &&
      (statusFilter === 'ALL' || r.status === statusFilter) &&
      (q === '' ||
        (r.registrationNumber?.toLowerCase().includes(q) ?? false) ||
        r.email.toLowerCase().includes(q)),
  )

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('registrations.title')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="regSearch" className="sr-only">
            {t('registrations.searchLabel')}
          </label>
          <input
            id="regSearch"
            type="search"
            inputMode="numeric"
            className="bdc-input"
            placeholder={t('registrations.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      {scopedEventId && scopedEventLabel && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm">
          <span className="text-gold-800">
            {t('registrations.showingEvent', { event: scopedEventLabel })}
          </span>
          <Link
            href={`${base}/registrations`}
            className="font-medium text-primary-600 hover:text-primary-700"
          >
            {t('registrations.clearEvent')}
          </Link>
        </div>
      )}

      {scopedEventId && hasMealData && (
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
        {!scopedEventId && (
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
                  {c.name}
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
              setStatusFilter(e.target.value as 'ALL' | AdminRegistrationStatus)
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                  {t('registrations.empty')}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-stone-50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`${base}/registrations/${r.id}`}
                      className="font-mono font-medium tabular-nums text-primary-600 hover:text-primary-700"
                    >
                      {r.registrationNumber ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{r.email}</td>
                  <td className="px-4 py-3 text-neutral-700">{centerName(r)}</td>
                  <td className="px-4 py-3 tabular-nums text-neutral-600">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                    {r.participantCount}
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
