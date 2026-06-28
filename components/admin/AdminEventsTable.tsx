'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { EventStatusBadge } from '@/components/admin/StatusBadge'
import { downloadRegistrationsExport } from '@/lib/admin/exportRegistrations'
import type { AdminEventListItem } from '@/modules/events'

type StatusValue = AdminEventListItem['status']

const STATUSES: StatusValue[] = ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED']

function formatDate(iso: string): string {
  const [year = '', month = '', day = ''] = iso.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

// Client island over the server-loaded admin event rows: the status filter runs
// client-side; data + ownership scoping are resolved server-side (listAdminEvents).
export default function AdminEventsTable({ events }: { events: AdminEventListItem[] }) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const base = `/${locale}/admin`

  const [statusFilter, setStatusFilter] = useState<'ALL' | StatusValue>('ALL')
  // Direct per-row XLSX export (single event, admin's UI language). `exportingId`
  // marks the row while the file is being generated; once it's handed to the
  // browser, the browser's own download UI (save dialog / download bar) is the
  // confirmation — we don't claim "downloaded" while a save dialog may still be open.
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const filtered =
    statusFilter === 'ALL' ? events : events.filter((e) => e.status === statusFilter)

  async function handleExport(eventId: string) {
    setExportError(null)
    setExportingId(eventId)
    try {
      const ok = await downloadRegistrationsExport(
        { eventId },
        locale === 'en' ? 'en' : 'cs',
      )
      if (!ok) setExportError(t('registrations.exportFailed'))
    } catch {
      setExportError(t('registrations.exportFailed'))
    } finally {
      setExportingId(null)
    }
  }

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <label htmlFor="statusFilter" className="text-sm font-medium text-neutral-600">
          {t('events.filterStatus')}
        </label>
        <select
          id="statusFilter"
          className="bdc-input w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'ALL' | StatusValue)}
        >
          <option value="ALL">{t('common.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`eventStatus.${s}`)}
            </option>
          ))}
        </select>
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
              <th className="px-4 py-3 font-medium">{t('events.table.title')}</th>
              <th className="px-4 py-3 text-center font-medium">{t('events.table.status')}</th>
              <th className="px-4 py-3 text-center font-medium">{t('events.table.start')}</th>
              <th className="px-4 py-3 text-center font-medium">{t('events.table.end')}</th>
              <th className="px-4 py-3 text-center font-medium">
                {t('events.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  {t('events.empty')}
                </td>
              </tr>
            ) : (
              filtered.map((event) => {
                const title = locale === 'cs' ? event.title_cs : event.title_en
                const centerName =
                  locale === 'cs' ? event.center.name_cs : event.center.name_en
                return (
                  <tr
                    key={event.id}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {centerName} — {title}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <EventStatusBadge status={event.status} />
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-neutral-600">
                      {formatDate(event.startDate)}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-neutral-600">
                      {formatDate(event.endDate)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-3 whitespace-nowrap">
                        {/* Edit only for DRAFT / PUBLISHED (validate-only until
                            PUT is wired in a later phase). */}
                        {event.status === 'DRAFT' || event.status === 'PUBLISHED' ? (
                          <Link
                            href={`${base}/events/${event.id}/edit`}
                            className="text-sm font-medium text-primary-600 hover:text-primary-700"
                          >
                            {t('events.edit')}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium text-neutral-300">
                            {t('events.edit')}
                          </span>
                        )}
                        <Link
                          href={`${base}/registrations?event=${event.id}`}
                          className="text-sm font-medium text-primary-600 hover:text-primary-700"
                        >
                          {t('events.details')}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleExport(event.id)}
                          disabled={exportingId !== null}
                          className="text-sm font-medium text-primary-600 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {exportingId === event.id
                            ? t('registrations.exporting')
                            : t('events.export')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
