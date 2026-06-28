'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { RegStatusBadge } from '@/components/admin/StatusBadge'
import { downloadRegistrationsExport } from '@/lib/admin/exportRegistrations'
import type {
  AdminRegistrationListItem,
  AdminRegistrationStatus,
  DayMealStat,
  NightStat,
} from '@/modules/registrations'

const REG_STATUSES: AdminRegistrationStatus[] = ['REGISTERED', 'PAID', 'CANCELLED']

function formatDate(iso: string): string {
  const [date = ''] = iso.split('T')
  const [year = '', month = '', day = ''] = date.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

// Client island over the server-loaded registration rows. Data + ownership
// scoping are resolved server-side (listRegistrations); meal stats are computed
// server-side too (getEventMealStats) and passed in. This island owns the
// centre/status/archive filters + the event-scoped presentation.
//
// Export lives ONLY in the event-scoped view (reached via an event's "Detaily"):
// the global all-registrations list — which mixes every event incl. historical —
// has no export. The events list offers a direct per-row export instead.
export default function RegistrationsTable({
  rows,
  scopedEventId,
  mealStats,
  nightStats,
}: {
  rows: AdminRegistrationListItem[]
  scopedEventId: string | null
  mealStats: DayMealStat[]
  nightStats: NightStat[]
}) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const base = `/${locale}/admin`

  const [centerFilter, setCenterFilter] = useState<'ALL' | string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | AdminRegistrationStatus>('ALL')
  // Historical registrations from archived events clutter the global list — hide
  // them by default, with a toggle to bring them back. (Drafts never have public
  // registrations, so the only noise worth filtering is the archive.)
  const [showArchived, setShowArchived] = useState(false)
  // On-site search by registration number (the team types the number to find a
  // registrant). Matches the email too, as a convenience. Already role/ownership
  // scoped server-side, so this only narrows the rows this admin may see.
  const [search, setSearch] = useState('')

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

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
  // Only surface the accommodation panel when someone is actually staying over.
  const hasNightData = nightStats.some((n) => n.count > 0)

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
      // Hide archived-event registrations on the global list unless asked for.
      (!!scopedEventId || showArchived || r.eventStatus !== 'ARCHIVED') &&
      (statusFilter === 'ALL' || r.status === statusFilter) &&
      (q === '' ||
        (r.registrationNumber?.toLowerCase().includes(q) ?? false) ||
        r.email.toLowerCase().includes(q)),
  )

  async function handleExport() {
    if (!scopedEventId) return
    setExportError(null)
    setExporting(true)
    try {
      // Send exactly the filters the admin currently sees (the server re-applies
      // them under the same ownership scope). Always one event; file language =
      // the admin's UI language. Once generated, the browser's own download UI is
      // the confirmation — we don't claim "downloaded" (a save dialog may be open).
      const ok = await downloadRegistrationsExport(
        {
          eventId: scopedEventId,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          search: q || undefined,
        },
        locale === 'en' ? 'en' : 'cs',
      )
      if (!ok) setExportError(t('registrations.exportFailed'))
    } catch {
      setExportError(t('registrations.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

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
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-3 py-2 font-medium">{t('registrations.mealStatsDay')}</th>
                  <th className="px-3 py-2 font-medium">{t('registrations.mealStatsMeal')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('registrations.mealStatsTotal')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('registrations.mealStatsMeat')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('registrations.mealStatsVege')}</th>
                </tr>
              </thead>
              <tbody>
                {mealStats.flatMap((day) =>
                  day.meals.map((m, idx) => (
                    <tr
                      key={`${day.dateId}-${m.mealType}`}
                      className="border-b border-neutral-100 last:border-0"
                    >
                      <td className="px-3 py-2 font-medium text-neutral-800">
                        {idx === 0 ? (locale === 'cs' ? day.label_cs : day.label_en) : ''}
                      </td>
                      <td className="px-3 py-2 text-neutral-700">{t(`mealType.${m.mealType}`)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-primary-600">
                        {m.count}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-700">
                        {m.meat}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-700">
                        {m.vege}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {scopedEventId && hasNightData && (
        <div className="section-card mb-5">
          <h2 className="font-serif text-lg font-semibold text-neutral-900">
            {t('registrations.accommodationStatsTitle')}
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-3 py-2 font-medium">{t('registrations.accommodationNight')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('registrations.accommodationCount')}</th>
                </tr>
              </thead>
              <tbody>
                {nightStats.map((n) => (
                  <tr key={n.dateId} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-neutral-800">
                      {locale === 'cs' ? n.label_cs : n.label_en}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-primary-600">
                      {n.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

        {!scopedEventId && (
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-neutral-300 text-primary-600"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t('registrations.showArchived')}
          </label>
        )}

        {scopedEventId && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={filtered.length === 0 || exporting}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? t('registrations.exporting') : t('registrations.exportExcel')}
            </button>
          </div>
        )}
      </div>

      {exportError && (
        <div className="mb-4 rounded-lg border border-danger-500/40 bg-danger-50 p-3 text-sm text-danger-700">
          {exportError}
        </div>
      )}

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
