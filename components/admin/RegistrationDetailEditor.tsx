'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { RegStatusBadge } from '@/components/admin/StatusBadge'
import type { AdminRegistrationStatus } from '@/modules/registrations'

const REG_STATUSES: AdminRegistrationStatus[] = ['REGISTERED', 'PAID', 'CANCELLED']
const PRICING_TYPES = ['STANDARD', 'SUPPORTED', 'SURPLUS'] as const
type PricingType = (typeof PRICING_TYPES)[number]

// One editable row per participant: the two tiers they are priced on.
export type EditableParticipantTiers = {
  id: string
  fullName: string
  pricingType: PricingType
  mealPricingType: PricingType
}

// The tiers this event actually offers for one half. An EMPTY set means all three
// — the same reading the submit service, the public form and the price overview
// use, so no surface can offer a choice another one would refuse.
function offeredTiers(set: string[]): readonly PricingType[] {
  const offered = PRICING_TYPES.filter((t) => set.includes(t))
  return offered.length > 0 ? offered : PRICING_TYPES
}

// What one select lists: the offered tiers, plus the one this person is actually
// on if the event no longer offers it. A `<select>` whose value matches no option
// renders a DIFFERENT tier than the row holds, so the admin would be shown — and
// could unknowingly save — something they never chose. Keeping the stored tier
// visible states the truth; the server still refuses to MOVE anyone onto a tier
// the event does not offer. An event with registrations cannot have its sets
// narrowed today, so this is a backstop, not a path anyone walks.
function optionsFor(offered: readonly PricingType[], current: PricingType): readonly PricingType[] {
  return offered.includes(current) ? offered : [current, ...offered]
}

// Editable card of the registration detail. Owns the status state so the badge
// shown next to the registration number (top band) updates live as the admin
// changes the dropdown — that's why the number band + pricing-info button live
// here, and the read-only summary is passed in as `children` (rendered between
// the band and the editable card). Data + ownership resolved server-side; this
// island only persists edits via PUT and triggers the resend POST. The
// registrant's home centre is NOT editable here (shown read-only in the summary)
// — its unchanged id is still sent so the PUT payload stays complete.
//
// Accommodation and each participant's two pricing tiers all move money, and the
// SERVER re-prices through the real engine before writing (invariants 3–4) — this
// island sends choices, never amounts, exactly like the public form. A half the
// event offers on one tier only renders no selector for it: there is nothing to
// choose, and a narrowed set would otherwise invite an edit the server refuses.
export default function RegistrationDetailEditor({
  registrationId,
  centerId,
  registrationNumber,
  numberLabel,
  pricingButton,
  initialHasAccommodation,
  initialStatus,
  initialParticipants,
  participationPricingTypes,
  mealPricingTypes,
  children,
}: {
  registrationId: string
  centerId: string
  registrationNumber: string
  numberLabel: string
  pricingButton: ReactNode
  initialHasAccommodation: boolean
  initialStatus: AdminRegistrationStatus
  initialParticipants: EditableParticipantTiers[]
  participationPricingTypes: string[]
  mealPricingTypes: string[]
  children: ReactNode
}) {
  const t = useTranslations('admin')
  const router = useRouter()

  const [hasAccommodation, setHasAccommodation] = useState(initialHasAccommodation)
  const [status, setStatus] = useState<AdminRegistrationStatus>(initialStatus)
  const [participants, setParticipants] = useState(initialParticipants)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const participationTiers = offeredTiers(participationPricingTypes)
  const mealTiers = offeredTiers(mealPricingTypes)
  // Show the block when there is a real choice — or when somebody sits on a tier
  // the event no longer offers, which the admin must at least be able to SEE.
  const strandedTier = participants.some(
    (p) => !participationTiers.includes(p.pricingType) || !mealTiers.includes(p.mealPricingType),
  )
  const tiersEditable =
    participants.length > 0 &&
    (participationTiers.length > 1 || mealTiers.length > 1 || strandedTier)

  const setTier = (id: string, field: 'pricingType' | 'mealPricingType', value: PricingType) =>
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)))

  async function handleSave() {
    setBusy(true)
    setToast(null)
    setError(null)
    try {
      const res = await fetch(`/api/admin/registrations/${registrationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Tiers ride along unchanged when nothing was touched; the server
        // re-prices only what actually moved, so this stays a no-op save.
        body: JSON.stringify({ centerId, hasAccommodation, status, participants }),
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

        {tiersEditable && (
          <div>
            <span className="form-label">{t('registrationDetail.pricingTiers')}</span>
            <p className="-mt-1 mb-3 text-xs text-neutral-500">
              {t('registrationDetail.pricingTiersHint')}
            </p>
            <div className="space-y-3">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-neutral-200 bg-stone-50 px-3.5 py-3"
                >
                  <p className="text-sm font-medium text-neutral-900">{p.fullName}</p>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {participationTiers.length > 1 && (
                      <TierSelect
                        id={`tier-participation-${p.id}`}
                        label={t('registrationDetail.participationPriceType')}
                        value={p.pricingType}
                        options={optionsFor(participationTiers, p.pricingType)}
                        optionLabel={(v) => t(`pricingType.${v}`)}
                        onChange={(v) => setTier(p.id, 'pricingType', v)}
                      />
                    )}
                    {mealTiers.length > 1 && (
                      <TierSelect
                        id={`tier-meal-${p.id}`}
                        label={t('registrationDetail.mealPriceType')}
                        value={p.mealPricingType}
                        options={optionsFor(mealTiers, p.mealPricingType)}
                        optionLabel={(v) => t(`pricingType.${v}`)}
                        onChange={(v) => setTier(p.id, 'mealPricingType', v)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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

// Plain labelled select — the tier lists are short and a row can carry two of
// them per participant, so a dropdown stays readable where the public form's
// pill group would not.
function TierSelect({
  id,
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  id: string
  label: string
  value: PricingType
  options: readonly PricingType[]
  optionLabel: (value: PricingType) => string
  onChange: (value: PricingType) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-500">
        {label}
      </label>
      <select
        id={id}
        className="bdc-input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value as PricingType)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
    </div>
  )
}
