'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { mockCenters, type MockCenter } from '@/lib/mock/registrationOptions'
import { mockUsers } from '@/lib/mock/users'

// NOTE (B6): Centers are read from mock data, sorted alphabetically. In B7 they
// come from the DB (the 25 seeded centres) and this whole page is SUPER_ADMIN
// only. Edit is UI-only here. All centres are active (no active/sortOrder).
export default function AdminCentersPage() {
  const t = useTranslations('admin')

  const [form, setForm] = useState<
    { id: string; name_cs: string; name_en: string } | null
  >(null)
  const [toast, setToast] = useState<string | null>(null)

  const sortedCenters = [...mockCenters].sort((a, b) =>
    a.name_cs.localeCompare(b.name_cs, 'cs'),
  )

  // Admin emails per centre, derived from mockUsers (ADMINs with that centre
  // assigned). SUPER_ADMINs see all centres and aren't listed per-centre.
  const adminEmails = (centerId: string): string[] =>
    mockUsers
      .filter((u) => u.role === 'ADMIN' && u.assignedCenterIds.includes(centerId))
      .map((u) => u.email)

  const openEdit = (c: MockCenter) => {
    setToast(null)
    setForm({ id: c.id, name_cs: c.name_cs, name_en: c.name_en })
  }
  // TODO(B7): persist via /api/admin/centers (and only allow SUPER_ADMIN).
  const handleSave = () => {
    setForm(null)
    setToast(t('centers.saved'))
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-neutral-900">
          {t('centers.title')}
        </h1>
        <div className="mt-2 h-0.5 w-12 rounded bg-primary-500" />
      </header>

      {/* TODO(B7): only SUPER_ADMIN should reach this page. */}
      <div className="mb-5 rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm text-gold-800">
        {t('centers.superAdminOnlyNote')}
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
              <th className="px-4 py-3 font-medium">{t('centers.table.nameCs')}</th>
              <th className="px-4 py-3 font-medium">{t('centers.table.nameEn')}</th>
              <th className="px-4 py-3 font-medium">{t('centers.table.adminEmail')}</th>
              <th className="px-4 py-3 text-right font-medium">
                {t('centers.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedCenters.map((c) => {
              const emails = adminEmails(c.id)
              return (
                <tr key={c.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-neutral-900">{c.name_cs}</td>
                  <td className="px-4 py-3 text-neutral-700">{c.name_en}</td>
                  <td className="px-4 py-3 text-neutral-700">
                    {emails.length > 0 ? emails.join(', ') : t('centers.noAdmins')}
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
              )
            })}
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
