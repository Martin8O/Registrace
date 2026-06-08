'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { mockEvents, type MockEvent } from '@/lib/mock/events'
import { EventStatusBadge } from '@/components/admin/StatusBadge'

const STATUSES: MockEvent['status'][] = ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED']

function formatDate(iso: string): string {
  const [year = '', month = '', day = ''] = iso.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

export default function AdminEventsPage() {
  const t = useTranslations('admin')
  const locale = useLocale()
  const base = `/${locale}/admin`

  const [statusFilter, setStatusFilter] = useState<'ALL' | MockEvent['status']>('ALL')

  const events =
    statusFilter === 'ALL'
      ? mockEvents
      : mockEvents.filter((e) => e.status === statusFilter)

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('events.title')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        </div>
        <Link href={`${base}/events/new`} className="btn-primary inline-block">
          {t('events.new')}
        </Link>
      </header>

      <div className="mb-5 flex items-center gap-3">
        <label htmlFor="statusFilter" className="text-sm font-medium text-neutral-600">
          {t('events.filterStatus')}
        </label>
        <select
          id="statusFilter"
          className="bdc-input w-auto"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as 'ALL' | MockEvent['status'])
          }
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
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  {t('events.empty')}
                </td>
              </tr>
            ) : (
              events.map((event) => {
                const title = locale === 'cs' ? event.title_cs : event.title_en
                return (
                  <tr
                    key={event.id}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {event.center.name} — {title}
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
                        {/* TODO(B7): open the stepper pre-filled for this event id
                            (no edit route in B6 — only create exists). */}
                        <button
                          type="button"
                          disabled
                          title={t('eventForm.saveSuccess')}
                          className="text-sm font-medium text-neutral-400 cursor-not-allowed"
                        >
                          {t('events.edit')}
                        </button>
                        <Link
                          href={`${base}/registrations`}
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
    </div>
  )
}
