'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { mockCenters } from '@/lib/mock/registrationOptions'
import { mockUsers, type MockUserRole } from '@/lib/mock/users'

const ROLES: MockUserRole[] = ['SUPER_ADMIN', 'ADMIN']

function formatDate(iso: string): string {
  const [date = ''] = iso.split('T')
  const [year = '', month = '', day = ''] = date.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

// NOTE: this whole page is migration-dependent scaffolding. In B6 it shows mock
// users only — no role lookup, no User/UserCenter query, no persistence. Every
// action below is // TODO(B7), including this page's SUPER_ADMIN-only visibility.
export default function AdminUsersPage() {
  const t = useTranslations('admin')
  const locale = useLocale()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MockUserRole>('ADMIN')
  const [centerIds, setCenterIds] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)

  const centerName = (id: string) => {
    const c = mockCenters.find((c) => c.id === id)
    if (!c) return id
    return locale === 'cs' ? c.name_cs : c.name_en
  }

  const assignedLabel = (role: MockUserRole, ids: string[]) => {
    if (role === 'SUPER_ADMIN') return t('users.allCenters')
    if (ids.length === 0) return t('users.noCenters')
    return ids.map(centerName).join(', ')
  }

  const toggleCenter = (id: string) =>
    setCenterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  // TODO(B7): "invite" creates a User + UserCenter rows (needs the migration);
  // role-based access, center assignment, and deactivate (soft) are all B7.
  const handleInvite = () => {
    setInviteOpen(false)
    setEmail('')
    setRole('ADMIN')
    setCenterIds([])
    setToast(t('users.invited'))
  }
  const handleDeactivate = () => setToast(t('users.invited'))

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('users.title')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        </div>
        <button
          type="button"
          onClick={() => {
            setToast(null)
            setInviteOpen((v) => !v)
          }}
          className="btn-primary"
        >
          {t('users.invite')}
        </button>
      </header>

      {/* TODO(B7): only SUPER_ADMIN should reach this page at all. */}
      <div className="mb-5 rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm text-gold-800">
        {t('users.superAdminOnlyNote')}
      </div>

      {toast && (
        <div className="mb-5 rounded-lg border border-success-500/40 bg-success-50 p-3 text-sm text-success-700">
          {toast}
        </div>
      )}

      <div className="section-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="px-4 py-3 font-medium">{t('users.table.email')}</th>
              <th className="px-4 py-3 font-medium">{t('users.table.role')}</th>
              <th className="px-4 py-3 font-medium">{t('users.table.centers')}</th>
              <th className="px-4 py-3 font-medium">{t('users.table.createdAt')}</th>
              <th className="px-4 py-3 text-right font-medium">
                {t('users.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {mockUsers.map((u) => (
              <tr key={u.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3 font-medium text-neutral-900">{u.email}</td>
                <td className="px-4 py-3">
                  <span className="badge bg-neutral-200 text-neutral-700 border border-neutral-300">
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-700">
                  {assignedLabel(u.role, u.assignedCenterIds)}
                </td>
                <td className="px-4 py-3 tabular-nums text-neutral-600">
                  {formatDate(u.createdAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={handleDeactivate}
                    className="text-sm font-medium text-danger-600 hover:text-danger-700"
                  >
                    {t('users.deactivate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inviteOpen && (
        <section className="section-card mt-6 space-y-5">
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <div>
              <label htmlFor="u-email" className="form-label">
                {t('users.inviteEmail')}
              </label>
              <input
                id="u-email"
                type="email"
                className="bdc-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="u-role" className="form-label">
                {t('users.inviteRole')}
              </label>
              <select
                id="u-role"
                className="bdc-input"
                value={role}
                onChange={(e) => setRole(e.target.value as MockUserRole)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="form-label">{t('users.inviteCenters')}</span>
            <div className="flex flex-wrap gap-2">
              {mockCenters.map((c) => {
                const checked = centerIds.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCenter(c.id)}
                    className={`rounded-lg border px-3.5 py-2 text-sm transition ${
                      checked
                        ? 'border-primary-500 bg-primary-50 font-medium text-primary-700'
                        : 'border-neutral-300 text-neutral-700 hover:border-neutral-400'
                    }`}
                  >
                    {locale === 'cs' ? c.name_cs : c.name_en}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={handleInvite} className="btn-primary">
              {t('users.send')}
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
