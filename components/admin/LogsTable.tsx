'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AuditLogRow } from '@/lib/audit'

// SUPER_ADMIN audit-log view (P4). Renders the append-only audit rows in human
// form: localized action label, actor email, entity, IP, Europe/Prague time
// (invariant 11), and an expandable before/after (oldData → newData) per row.
// Read-only — no mutations.
export default function LogsTable({ rows }: { rows: AuditLogRow[] }) {
  const t = useTranslations('admin.logs')
  const locale = useLocale()
  const [open, setOpen] = useState<Set<string>>(new Set())

  const fmt = new Intl.DateTimeFormat(locale === 'cs' ? 'cs-CZ' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/Prague',
  })

  function actionLabel(action: string): string {
    return t.has(`actions.${action}`) ? t(`actions.${action}`) : action
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (rows.length === 0) {
    return <div className="section-card text-neutral-600">{t('empty')}</div>
  }

  return (
    <div className="section-card overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-500">
          <tr>
            <th className="px-4 py-3 font-medium">{t('table.time')}</th>
            <th className="px-4 py-3 font-medium">{t('table.actor')}</th>
            <th className="px-4 py-3 font-medium">{t('table.action')}</th>
            <th className="px-4 py-3 font-medium">{t('table.entity')}</th>
            <th className="px-4 py-3 font-medium">{t('table.ip')}</th>
            <th className="px-4 py-3 font-medium" aria-label={t('table.details')} />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => {
            const isOpen = open.has(r.id)
            const hasDetails = r.oldData != null || r.newData != null
            return (
              <FragmentRow
                key={r.id}
                row={r}
                isOpen={isOpen}
                hasDetails={hasDetails}
                onToggle={() => toggle(r.id)}
                time={fmt.format(new Date(r.createdAt))}
                actionLabel={actionLabel(r.action)}
                labels={{
                  details: t('table.details'),
                  hide: t('table.hide'),
                  before: t('table.before'),
                  after: t('table.after'),
                }}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FragmentRow({
  row,
  isOpen,
  hasDetails,
  onToggle,
  time,
  actionLabel,
  labels,
}: {
  row: AuditLogRow
  isOpen: boolean
  hasDetails: boolean
  onToggle: () => void
  time: string
  actionLabel: string
  labels: { details: string; hide: string; before: string; after: string }
}) {
  return (
    <>
      <tr className="align-top">
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-neutral-700">
          {time}
        </td>
        <td className="px-4 py-3 text-neutral-700">{row.actorEmail ?? row.actorId ?? '—'}</td>
        <td className="px-4 py-3">
          <span className="inline-block rounded bg-primary-50 px-2 py-0.5 font-medium text-primary-700">
            {actionLabel}
          </span>
        </td>
        <td className="px-4 py-3 text-neutral-600">
          {row.entityType}
          <span className="ml-1 font-mono text-xs text-neutral-400">{row.entityId.slice(0, 8)}…</span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">
          {row.ip ?? '—'}
        </td>
        <td className="px-4 py-3 text-right">
          {hasDetails && (
            <button type="button" onClick={onToggle} className="text-xs font-medium text-primary-600 hover:underline">
              {isOpen ? labels.hide : labels.details}
            </button>
          )}
        </td>
      </tr>
      {isOpen && hasDetails && (
        <tr>
          <td colSpan={6} className="bg-neutral-50 px-4 py-3">
            <div className="grid gap-4 sm:grid-cols-2">
              {row.oldData != null && (
                <DetailBlock title={labels.before} value={row.oldData} />
              )}
              {row.newData != null && (
                <DetailBlock title={labels.after} value={row.newData} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function DetailBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">{title}</p>
      <pre className="overflow-x-auto rounded bg-white p-3 font-mono text-xs text-neutral-700 ring-1 ring-neutral-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
