'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { mockCenters, type MockCenter } from '@/lib/mock/registrationOptions'

type CenterForm = {
  name_cs: string
  name_en: string
  isActive: boolean
  sortOrder: number
}

const emptyForm: CenterForm = {
  name_cs: '',
  name_en: '',
  isActive: true,
  sortOrder: 0,
}

export default function AdminCentersPage() {
  const t = useTranslations('admin')

  const [form, setForm] = useState<CenterForm | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const openAdd = () => {
    setToast(null)
    setForm({ ...emptyForm })
  }
  const openEdit = (c: MockCenter) => {
    setToast(null)
    setForm({
      name_cs: c.name_cs,
      name_en: c.name_en,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
    })
  }
  // TODO(B7): persist via /api/admin/centers (POST/PUT). B6 is UI-only.
  const handleSave = () => {
    setForm(null)
    setToast(t('centers.saved'))
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
        <button type="button" onClick={openAdd} className="btn-primary">
          {t('centers.add')}
        </button>
      </header>

      {toast && (
        <div className="mb-5 rounded-lg border border-success-500/40 bg-success-50 p-3 text-sm text-success-700">
          {toast}
        </div>
      )}

      <div className="section-card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="px-4 py-3 font-medium">{t('centers.table.nameCs')}</th>
              <th className="px-4 py-3 font-medium">{t('centers.table.nameEn')}</th>
              <th className="px-4 py-3 font-medium">{t('centers.table.active')}</th>
              <th className="px-4 py-3 text-right font-medium">
                {t('centers.table.sortOrder')}
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {t('centers.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {mockCenters.map((c) => (
              <tr key={c.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3 font-medium text-neutral-900">{c.name_cs}</td>
                <td className="px-4 py-3 text-neutral-700">{c.name_en}</td>
                <td className="px-4 py-3">
                  <span
                    className={`badge ${
                      c.isActive
                        ? 'bg-success-100 text-success-700 border border-success-500/40'
                        : 'bg-neutral-200 text-neutral-600 border border-neutral-300'
                    }`}
                  >
                    {c.isActive ? t('centers.active') : t('centers.inactive')}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-600">
                  {c.sortOrder}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => openEdit(c)}
                    className="text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    {t('centers.edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <section className="section-card mt-6 space-y-5">
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
            <div>
              <label htmlFor="c-sort" className="form-label">
                {t('centers.sortOrder')}
              </label>
              <input
                id="c-sort"
                type="number"
                className="bdc-input"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm({ ...form, sortOrder: Number(e.target.value) || 0 })
                }
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary-500"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              {t('centers.active')}
            </label>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={handleSave} className="btn-primary">
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
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
