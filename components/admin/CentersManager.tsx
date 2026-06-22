'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import ConfirmDialog from '@/components/admin/ConfirmDialog'
import type { AdminCenterListItem } from '@/modules/centers'

type FormState = { id: string | null; name_cs: string; name_en: string }

// Client island over the server-loaded centres (SUPER_ADMIN-gated page).
// Create / rename persist via POST/PUT; "delete" is a soft deactivate (DELETE →
// isActive=false, hidden from every picker, restorable via PATCH). After every
// write we router.refresh() so the server-rendered list re-reads the DB.
export default function CentersManager({
  centers,
}: {
  centers: AdminCenterListItem[]
}) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const router = useRouter()

  const [form, setForm] = useState<FormState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminCenterListItem | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  // Scroll the edit/create form into view when it opens (it lives below the list).
  useEffect(() => {
    if (form) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [form])

  const name = (c: AdminCenterListItem) => (locale === 'cs' ? c.name_cs : c.name_en)

  const openCreate = () => {
    setToast(null)
    setError(null)
    setForm({ id: null, name_cs: '', name_en: '' })
  }
  const openEdit = (c: AdminCenterListItem) => {
    setToast(null)
    setError(null)
    setForm({ id: c.id, name_cs: c.name_cs, name_en: c.name_en })
  }

  async function handleSave() {
    if (!form) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        form.id ? `/api/admin/centers/${form.id}` : '/api/admin/centers',
        {
          method: form.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name_cs: form.name_cs, name_en: form.name_en }),
        },
      )
      if (res.ok) {
        setToast(t(form.id ? 'centers.saved' : 'centers.created'))
        setForm(null)
        router.refresh()
      } else {
        setError(t(form.id ? 'centers.saveFailed' : 'centers.createFailed'))
      }
    } catch {
      setError(t(form.id ? 'centers.saveFailed' : 'centers.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    if (!confirmDelete) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/centers/${confirmDelete.id}`, { method: 'DELETE' })
      if (res.ok) {
        setToast(t('centers.deleted'))
        setForm(null)
        router.refresh()
      } else {
        setError(t('centers.deleteFailed'))
      }
    } catch {
      setError(t('centers.deleteFailed'))
    } finally {
      setBusy(false)
      setConfirmDelete(null)
    }
  }

  async function restore(c: AdminCenterListItem) {
    setBusy(true)
    setError(null)
    setToast(null)
    try {
      const res = await fetch(`/api/admin/centers/${c.id}`, { method: 'PATCH' })
      if (res.ok) {
        setToast(t('centers.restored'))
        router.refresh()
      } else {
        setError(t('centers.saveFailed'))
      }
    } catch {
      setError(t('centers.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-neutral-900">
            {t('centers.title')}
          </h1>
          <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
        </div>
        <button type="button" onClick={openCreate} className="btn-primary">
          {t('centers.add')}
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
              <th className="px-4 py-3 font-medium">{t('centers.table.nameCs')}</th>
              <th className="px-4 py-3 font-medium">{t('centers.table.nameEn')}</th>
              <th className="px-4 py-3 font-medium">{t('centers.table.adminEmail')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('centers.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {centers.map((c) => (
              <tr
                key={c.id}
                className={`border-b border-neutral-100 last:border-0 ${c.isActive ? '' : 'opacity-60'}`}
              >
                <td className="px-4 py-3 font-medium text-neutral-900">
                  {c.name_cs}
                  {!c.isActive && (
                    <span className="badge ml-2 bg-neutral-200 text-neutral-600 border border-neutral-300">
                      {t('centers.inactive')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-700">{c.name_en}</td>
                <td className="px-4 py-3 text-neutral-700">
                  {c.adminEmails.length > 0 ? c.adminEmails.join(', ') : t('centers.noAdmins')}
                </td>
                <td className="px-4 py-3 text-right">
                  {c.isActive ? (
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      {t('centers.edit')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => restore(c)}
                      disabled={busy}
                      className="text-sm font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                    >
                      {t('centers.restore')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <section ref={formRef} className="section-card mt-6 space-y-5 scroll-mt-6">
          <h2 className="font-serif text-xl font-semibold text-neutral-900">
            {form.id ? t('centers.edit') : t('centers.addTitle')}
          </h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <div>
              <label htmlFor="c-name-cs" className="form-label">
                {t('centers.nameCs')}
              </label>
              <input
                id="c-name-cs"
                className="bdc-input"
                value={form.name_cs}
                onChange={(e) => setForm({ ...form, name_cs: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="c-name-en" className="form-label">
                {t('centers.nameEn')}
              </label>
              <input
                id="c-name-en"
                className="bdc-input"
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !form.name_cs.trim() || !form.name_en.trim()}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setForm(null)} className="btn-secondary">
              {t('common.cancel')}
            </button>
            {/* Delete (deactivate) — only when editing an existing centre. */}
            {form.id && (
              <button
                type="button"
                onClick={() => {
                  const c = centers.find((x) => x.id === form.id)
                  if (c) setConfirmDelete(c)
                }}
                className="ml-auto text-sm font-medium text-danger-600 hover:text-danger-700"
              >
                {t('centers.delete')}
              </button>
            )}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('centers.deleteConfirmTitle')}
        body={confirmDelete ? t('centers.deleteConfirmBody', { name: name(confirmDelete) }) : ''}
        confirmLabel={t('centers.delete')}
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
