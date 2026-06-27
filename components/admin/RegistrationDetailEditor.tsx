'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { RegStatusBadge } from '@/components/admin/StatusBadge'
import type { AdminRegistrationStatus } from '@/modules/registrations'

const REG_STATUSES: AdminRegistrationStatus[] = ['REGISTERED', 'PAID', 'CANCELLED']

// Editable card of the registration detail. Owns the status state so the badge
// shown next to the registration number (top band) updates live as the admin
// changes the dropdown — that's why the number band + pricing-info button live
// here, and the read-only summary is passed in as `children` (rendered between
// the band and the editable card). Data + ownership resolved server-side; this
// island only persists edits via PUT and triggers the resend POST. The
// registrant's home centre is NOT editable here (shown read-only in the summary)
// — its unchanged id is still sent so the PUT payload stays complete. No price
// recompute (decision 2).
export default function RegistrationDetailEditor({
  registrationId,
  centerId,
  registrationNumber,
  numberLabel,
  pricingButton,
  initialHasAccommodation,
  initialStatus,
  children,
}: {
  registrationId: string
  centerId: string
  registrationNumber: string
  numberLabel: string
  pricingButton: ReactNode
  initialHasAccommodation: boolean
  initialStatus: AdminRegistrationStatus
  children: ReactNode
}) {
  const t = useTranslations('admin')
  const router = useRouter()

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
    <div className="space-y-6">
      {/* Number band: registration number centered with its live status badge
          beside it; the pricing-info popup sits on the right (its own line on
          mobile, top-right on wider screens). */}
      <div className="relative">
        <div className="mb-3 flex justify-end sm:absolute sm:right-0 sm:top-0 sm:mb-0">
          {pricingButton}
        </div>
        <div className="flex flex-col items-center text-center">
          {/* Label centers over the number only; the badge is taken out of flow
              (absolute, to the number's right) so it doesn't shift that centering. */}
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {numberLabel}
          </p>
          <div className="relative mt-1 inline-flex">
            <p className="font-mono text-3xl font-semibold tabular-nums text-neutral-900">
              {registrationNumber}
            </p>
            <span className="absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap">
              <RegStatusBadge status={status} />
            </span>
          </div>
        </div>
      </div>

      {/* Read-only summary (server-rendered) */}
      {children}

      {/* Editable accommodation / status + save / resend */}
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
            <select
              id="status"
              className="bdc-input w-auto"
              value={status}
              onChange={(e) => setStatus(e.target.value as AdminRegistrationStatus)}
            >
              {REG_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`regStatus.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Both actions centered (layout request) */}
        <div className="flex flex-wrap justify-center gap-3 pt-2">
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
    </div>
  )
}
