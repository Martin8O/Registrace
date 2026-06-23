'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { RegStatusBadge } from '@/components/admin/StatusBadge'
import type { AdminRegistrationStatus } from '@/modules/registrations'
import type { CenterDTO } from '@/modules/events'

const REG_STATUSES: AdminRegistrationStatus[] = ['REGISTERED', 'PAID', 'CANCELLED']

// Editable card of the registration detail (home centre / accommodation / status
// + save + resend). Data + ownership resolved server-side; this island only
// persists edits via PUT and triggers the resend POST. No price recompute
// (decision 2 — pricing is P5).
export default function RegistrationDetailEditor({
  registrationId,
  centers,
  initialCenterId,
  initialHasAccommodation,
  initialStatus,
}: {
  registrationId: string
  centers: CenterDTO[]
  initialCenterId: string
  initialHasAccommodation: boolean
  initialStatus: AdminRegistrationStatus
}) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const router = useRouter()

  const [centerId, setCenterId] = useState(initialCenterId)
  const [hasAccommodation, setHasAccommodation] = useState(initialHasAccommodation)
  const [status, setStatus] = useState<AdminRegistrationStatus>(initialStatus)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    setBusy(true)
    setToast(null)
    setError(null)
    try {
      const res = await fetch(`/api/admin/registrations/${registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centerId, hasAccommodation, status }),
      })
      if (res.ok) {
        setToast(t('registrationDetail.saved'))
        router.refresh()
      } else {
        setError(t('registrationDetail.saveFailed'))
      }
    } catch {
      setError(t('registrationDetail.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleResend() {
    setBusy(true)
    setToast(null)
    setError(null)
    try {
      // No body: the email language is resolved server-side from the
      // registration's stored locale (the visitor's original language, P6).
      const res = await fetch(
        `/api/admin/registrations/${registrationId}/resend-confirmation`,
        { method: 'POST' },
      )
      const json = (await res.json().catch(() => null)) as
        | { data?: { confirmationSent?: boolean } }
        | null
      if (res.ok && json?.data?.confirmationSent) {
        setToast(t('registrationDetail.resent'))
        router.refresh()
      } else if (res.ok) {
        // Sent path returned but the provider rejected the recipient (Resend
        // test-mode delivers only to the account owner) — surface it honestly.
        setError(t('registrationDetail.resendFailed'))
      } else {
        setError(t('registrationDetail.saveFailed'))
      }
    } catch {
      setError(t('registrationDetail.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section-card space-y-5">
      {toast && (
        <div className="rounded-lg border border-success-500/40 bg-success-50 p-3 text-sm text-success-700">
          {toast}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-danger-500/40 bg-danger-50 p-3 text-sm text-danger-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
        <div>
          <label htmlFor="center" className="form-label">
            {t('registrationDetail.homeCenter')}
          </label>
          <select
            id="center"
            className="bdc-input"
            value={centerId}
            onChange={(e) => setCenterId(e.target.value)}
          >
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {locale === 'cs' ? c.name_cs : c.name_en}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="form-label">{t('registrationDetail.accommodation')}</span>
          <div className="flex flex-wrap gap-2">
            {[
              { value: true, key: 'yes' },
              { value: false, key: 'no' },
            ].map((opt) => {
              const active = hasAccommodation === opt.value
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setHasAccommodation(opt.value)}
                  className={`rounded-lg border px-3.5 py-2 text-sm transition ${
                    active
                      ? 'border-primary-500 bg-primary-50 font-medium text-primary-700'
                      : 'border-neutral-300 text-neutral-700 hover:border-neutral-400'
                  }`}
                >
                  {t(`common.${opt.key}`)}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label htmlFor="status" className="form-label">
            {t('registrationDetail.status')}
          </label>
          <div className="flex items-center gap-3">
            <select
              id="status"
              className="bdc-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as AdminRegistrationStatus)}
            >
              {REG_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`regStatus.${s}`)}
                </option>
              ))}
            </select>
            <RegStatusBadge status={status} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('registrationDetail.save')}
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={busy}
          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('registrationDetail.resend')}
        </button>
      </div>
    </section>
  )
}
