'use client'

import { useTranslations } from 'next-intl'
import type { PricingRuleDTO } from '@/lib/types'

type Props = {
  isOpen: boolean
  onClose: () => void
  participantNumber: number
  ageCategory: string
  pricingType?: string
  pricingRules: PricingRuleDTO[]
  days: number
  arrivalTime?: string
  arrivalTimeLabel: string
  earlyDeparture: string
  hasAccommodation: boolean
}

type Row = { label: string; value: string; emphasis?: boolean }

// Informational breakdown of ONE participant's participation price. Mirrors the
// pure engine in modules/pricing EXACTLY (dailyRate × days − arrival discount −
// early-departure discount + nightRate × (days − 1), floored at 0) so the sum
// shown here equals the server-authoritative price (invariant 3 — this is
// display only; the backend price stays authoritative). Participation is
// data-driven: a category whose rule rate is 0 (young children, and 8–14 in
// events that don't charge them) shows a "no participation charge" note.
export default function ParticipationPriceModal({
  isOpen,
  onClose,
  participantNumber,
  ageCategory,
  pricingType,
  pricingRules,
  days,
  arrivalTime,
  arrivalTimeLabel,
  earlyDeparture,
  hasAccommodation,
}: Props) {
  const t = useTranslations('form.participationModal')

  if (!isOpen) return null

  const rule = pricingRules.find(
    (r) => r.ageCategory === ageCategory && r.pricingType === (pricingType ?? 'STANDARD'),
  )

  const rows: Row[] = []
  let note: string | null = null

  if (days <= 0) {
    note = t('selectStay')
  } else if (!rule || rule.dailyRate === 0) {
    // No participation charge in this category (young children, or 8–14 where the
    // event sets no rate). Meals are still charged separately.
    note = t('childNote')
  } else {
    const base = rule.dailyRate * days
    rows.push({
      label: t('base', { rate: rule.dailyRate, days }),
      value: `${base} CZK`,
    })

    const arrivalDiscount =
      arrivalTime === 'MORNING'
        ? rule.morningArrivalDiscount
        : arrivalTime === 'AFTERNOON'
          ? rule.afternoonArrivalDiscount
          : arrivalTime === 'EVENING'
            ? rule.eveningArrivalDiscount
            : 0
    if (arrivalTime && arrivalDiscount > 0) {
      rows.push({
        label: t('arrivalDiscount', { time: arrivalTimeLabel }),
        value: `−${arrivalDiscount} CZK`,
      })
    }

    if (earlyDeparture === 'AFTER_BREAKFAST' && rule.earlyDepartureDiscount > 0) {
      rows.push({
        label: t('earlyDepartureDiscount'),
        value: `−${rule.earlyDepartureDiscount} CZK`,
      })
    }

    const nights = days - 1
    if (hasAccommodation && nights > 0 && rule.nightRate > 0) {
      rows.push({
        label: t('accommodation', { nights, rate: rule.nightRate }),
        value: `+${rule.nightRate * nights} CZK`,
      })
    }

    const total = Math.max(
      0,
      base -
        arrivalDiscount -
        (earlyDeparture === 'AFTER_BREAKFAST' ? rule.earlyDepartureDiscount : 0) +
        (hasAccommodation && nights > 0 ? rule.nightRate * nights : 0),
    )
    rows.push({ label: t('total'), value: `${total} CZK`, emphasis: true })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 md:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-serif text-2xl font-semibold text-neutral-900">
            {t('title', { number: participantNumber })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 text-2xl font-bold leading-none transition"
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <div className="h-0.5 w-10 bg-primary-500 mt-2 mb-6 rounded" />

        {note ? (
          <p className="text-sm text-neutral-600">{note}</p>
        ) : (
          <div className="rounded-lg border border-neutral-200 overflow-hidden">
            {rows.map((row, i) => (
              <div
                key={row.label}
                className={`flex items-center justify-between px-4 py-2.5 ${
                  row.emphasis
                    ? 'bg-stone-100 border-t border-neutral-200'
                    : i % 2 === 0
                      ? 'bg-white'
                      : 'bg-stone-50'
                }`}
              >
                <span
                  className={`text-sm ${
                    row.emphasis ? 'font-semibold text-neutral-900' : 'text-neutral-700'
                  }`}
                >
                  {row.label}
                </span>
                <span
                  className={`font-mono text-[15px] tabular-nums ${
                    row.emphasis ? 'font-semibold text-primary-700' : 'text-primary-600'
                  }`}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 text-right">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
