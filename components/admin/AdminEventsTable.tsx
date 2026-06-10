'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { EventStatusBadge } from '@/components/admin/StatusBadge'
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

  const filtered =
    statusFilter === 'ALL' ? events : events.filter((e) => e.status === statusFilter)

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

      <div className="section-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="px-4 py-3 font-medium">{t('events.table.title')}</th>
              <th className="px-4 py-3 font-medium">{t('events.table.status')}</th>
              <th className="px-4 py-3 font-medium">{t('events.table.start')}</th>
              <th className="px-4 py-3 font-medium">{t('events.table.end')}</th>
              <th className="px-4 py-3 text-right font-medium">
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
                    <td className="px-4 py-3">
                      <EventStatusBadge status={event.status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-neutral-600">
                      {formatDate(event.startDate)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-neutral-600">
                      {formatDate(event.endDate)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
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
                          {t('events.viewRegistrations')}
                        </Link>
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
