'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { mockEvents } from '@/lib/mock/events'
import { mockCenters } from '@/lib/mock/registrationOptions'
import {
  mockRegistrations,
  type MockRegistrationStatus,
} from '@/lib/mock/registrations'
import { RegStatusBadge } from '@/components/admin/StatusBadge'

const REG_STATUSES: MockRegistrationStatus[] = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'WAITLIST',
]

function formatDate(iso: string): string {
  const [date = ''] = iso.split('T')
  const [year = '', month = '', day = ''] = date.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

export default function AdminRegistrationsPage() {
  const t = useTranslations('admin')
  const locale = useLocale()
  const base = `/${locale}/admin`

  const [eventFilter, setEventFilter] = useState<'ALL' | string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | MockRegistrationStatus>('ALL')

  const centerName = (id: string) => {
    const c = mockCenters.find((c) => c.id === id)
    if (!c) return id
    return locale === 'cs' ? c.name_cs : c.name_en
  }

  const rows = mockRegistrations.filter(
    (r) =>
      (eventFilter === 'ALL' || r.eventId === eventFilter) &&
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

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="eventFilter" className="text-sm font-medium text-neutral-600">
            {t('registrations.filterEvent')}
          </label>
          <select
            id="eventFilter"
            className="bdc-input w-auto"
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
          >
            <option value="ALL">{t('registrations.allEvents')}</option>
            {mockEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {locale === 'cs' ? ev.title_cs : ev.title_en}
              </option>
            ))}
          </select>
        </div>

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
                  <td className="px-4 py-3 text-neutral-700">{centerName(r.centerId)}</td>
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
