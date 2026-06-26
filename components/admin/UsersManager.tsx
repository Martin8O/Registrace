'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import ConfirmDialog from '@/components/admin/ConfirmDialog'
import type { AdminUserListItem, AdminUserRole } from '@/modules/users'
import type { CenterDTO } from '@/modules/events'

const ROLES: AdminUserRole[] = ['SUPER_ADMIN', 'ADMIN']

function formatDate(iso: string): string {
  const [date = ''] = iso.split('T')
  const [year = '', month = '', day = ''] = date.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

type Editor = { mode: 'invite' } | { mode: 'edit'; user: AdminUserListItem }

// Client island over the server-loaded users. Page-level SUPER_ADMIN gating +
// data come from the server; this island calls the real /api/admin/users
// endpoints (invite / role+centre update / password-reset email).
export default function UsersManager({
  users,
  centers,
  currentUserId,
  isOwner,
}: {
  users: AdminUserListItem[]
  centers: CenterDTO[]
  currentUserId: string
  isOwner: boolean
}) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const router = useRouter()

  const [editor, setEditor] = useState<Editor | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AdminUserRole>('ADMIN')
  const [centerIds, setCenterIds] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<AdminUserListItem | null>(null)
  const editorRef = useRef<HTMLElement>(null)

  // Scroll the invite/edit editor into view when it opens (it lives below the table).
  useEffect(() => {
    if (editor) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editor])

  const sortedCenters = [...centers].sort((a, b) =>
    a.name_cs.localeCompare(b.name_cs, 'cs'),
  )
  const centerName = (id: string) => {
    const c = centers.find((c) => c.id === id)
    if (!c) return id
    return locale === 'cs' ? c.name_cs : c.name_en
  }

  const assignedLabel = (u: AdminUserListItem) => {
    if (u.role === 'SUPER_ADMIN') return t('users.allCenters')
    if (u.assignedCenters.length === 0) return t('users.noCenters')
    return u.assignedCenters
      .map((c) => (locale === 'cs' ? c.name_cs : c.name_en))
      .join(', ')
  }

  const toggleCenter = (id: string) =>
    setCenterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const openInvite = () => {
    setToast(null)
    setError(null)
    setEmail('')
    setRole('ADMIN')
    setCenterIds([])
    setEditor({ mode: 'invite' })
  }
  const openEdit = (u: AdminUserListItem) => {
    setToast(null)
    setError(null)
    setEmail(u.email)
    setRole(u.role)
    setCenterIds(u.assignedCenters.map((c) => c.id))
    setEditor({ mode: 'edit', user: u })
  }

  async function handleSave() {
    if (!editor) return
    setBusy(true)
    setError(null)
    try {
      const res =
        editor.mode === 'invite'
          ? await fetch('/api/admin/users', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, role, centerIds }),
            })
          : await fetch(`/api/admin/users/${editor.user.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role, centerIds }),
            })
      if (res.ok) {
        setEditor(null)
        setToast(editor.mode === 'invite' ? t('users.invited') : t('users.saved'))
        router.refresh()
      } else {
        setError(t('users.actionFailed'))
      }
    } catch {
      setError(t('users.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleSendResetEmail(userId: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
      })
      const json = (await res.json().catch(() => null)) as
        | { data?: { sent?: boolean } }
        | null
      if (res.ok && json?.data?.sent) {
        setToast(t('users.sentResetEmail'))
      } else {
        setError(t('users.actionFailed'))
      }
    } catch {
      setError(t('users.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function doRemove() {
    if (!confirmRemove) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${confirmRemove.id}`, { method: 'DELETE' })
      if (res.ok) {
        setEditor(null)
        setToast(t('users.removed'))
        router.refresh()
      } else {
        setError(t('users.actionFailed'))
      }
    } catch {
      setError(t('users.actionFailed'))
    } finally {
      setBusy(false)
      setConfirmRemove(null)
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('users.title')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        </div>
        <button type="button" onClick={openInvite} className="btn-primary">
          {t('users.invite')}
        </button>
      </header>

      {toast && (
        <div className="mb-5 rounded-lg border border-success-500/40 bg-success-50 p-3 text-sm text-success-700">
          {toast}
        </div>
      )}
      {error && (
        <div className="mb-5 rounded-lg border border-danger-500/40 bg-danger-50 p-3 text-sm text-danger-700">
          {error}
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
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  {t('users.empty')}
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-neutral-900">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="badge bg-neutral-200 text-neutral-700 border border-neutral-300">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{assignedLabel(u)}</td>
                  <td className="px-4 py-3 tabular-nums text-neutral-600">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* A super-admin row is editable only by the owner; others
                        manage admins only (the API enforces this too). */}
                    {u.role === 'SUPER_ADMIN' && !isOwner ? (
                      <span className="text-sm text-neutral-400">—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="text-sm font-medium text-primary-600 hover:text-primary-700"
                      >
                        {t('users.edit')}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editor && (
        <section ref={editorRef} className="section-card mt-6 space-y-5 scroll-mt-6">
          <h2 className="font-serif text-xl font-semibold text-neutral-900">
            {editor.mode === 'invite' ? t('users.invite') : t('users.editTitle')}
          </h2>

          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <div>
              <label htmlFor="u-email" className="form-label">
                {t('users.inviteEmail')}
              </label>
              <input
                id="u-email"
                type="email"
                className={`bdc-input ${editor.mode === 'edit' ? 'bg-neutral-50 text-neutral-600' : ''}`}
                value={email}
                readOnly={editor.mode === 'edit'}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="u-role" className="form-label">
                {t('users.role')}
              </label>
              <select
                id="u-role"
                className="bdc-input"
                value={role}
                onChange={(e) => setRole(e.target.value as AdminUserRole)}
              >
                {/* Only the owner may assign the SUPER_ADMIN role. */}
                {(isOwner ? ROLES : ROLES.filter((r) => r !== 'SUPER_ADMIN')).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {role === 'ADMIN' && (
            <div>
              <span className="form-label">{t('users.centers')}</span>
              <div className="flex flex-wrap gap-2">
                {sortedCenters.map((c) => {
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
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editor.mode === 'invite' ? t('users.send') : t('common.save')}
            </button>
            {editor.mode === 'edit' && (
              <button
                type="button"
                onClick={() => handleSendResetEmail(editor.user.id)}
                disabled={busy}
                className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('users.sendResetEmail')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            {/* Remove admin — only when editing someone OTHER than yourself, and
                never a super-admin (those accounts can't be removed; the API
                enforces this too). */}
            {editor.mode === 'edit' &&
              editor.user.id !== currentUserId &&
              editor.user.role !== 'SUPER_ADMIN' && (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(editor.user)}
                  className="ml-auto text-sm font-medium text-danger-600 hover:text-danger-700"
                >
                  {t('users.remove')}
                </button>
              )}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        title={t('users.removeConfirmTitle')}
        body={confirmRemove ? t('users.removeConfirmBody', { email: confirmRemove.email }) : ''}
        confirmLabel={t('users.remove')}
        busy={busy}
        onConfirm={doRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  )
}
