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
// display only; the backend price stays authoritative).
//
// "Participation price" is the whole left-hand half of the price: the daily rate
// AND the nights. The two are priced by separate fields of the same rule, so
// either can be 0 on its own — a weekend with no paid programme charges 0/day and
// 200/night, which is the commonest Těnovice event. This used to read the daily
// rate alone as the test for "is anything charged": with dailyRate 0 it showed
// "no participation charge in this category" beside a row reading 400 CZK, and it
// said so to a 15+ adult, which is neither true nor about a category. The note now
// appears only when the breakdown itself is empty — i.e. when nothing at all is
// charged — so a 0-rate row is explained by the lines that ARE charged.
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
  } else if (!rule) {
    // No rule for this age × tier at all — the engine prices that as 0.
    note = t('childNote')
  } else {
    const base = rule.dailyRate * days
    const nights = days - 1
    const accommodation = hasAccommodation && nights > 0 ? rule.nightRate * nights : 0

    // Nothing positive on either field of the rule — young children, or a category
    // this event does not charge for and no night to add. That, and only that, is
    // what the "no participation charge" note means. Discounts are deliberately not
    // consulted here: a discount against nothing is not a charge, and the engine
    // floors the total at 0 anyway, so listing one under a total of 0 would explain
    // a deduction that never happened.
    if (base === 0 && accommodation === 0) {
      note = t('childNote')
    } else {
      // A rate of 0 is a real configuration (no paid programme); "3 days × 0 Kč" is
      // a line carrying no information, so it is skipped rather than shown as a zero.
      if (base > 0) {
        rows.push({
          label: t('base', { rate: rule.dailyRate, days }),
          value: `${base} CZK`,
        })
      }

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

      const earlyDiscount =
        earlyDeparture === 'AFTER_BREAKFAST' ? rule.earlyDepartureDiscount : 0
      if (earlyDiscount > 0) {
        rows.push({
          label: t('earlyDepartureDiscount'),
          value: `−${earlyDiscount} CZK`,
        })
      }

      if (accommodation > 0) {
        rows.push({
          label: t('accommodation', { nights, rate: rule.nightRate }),
          value: `+${accommodation} CZK`,
        })
      }

      // Same arithmetic as the engine, floored at 0 the same way.
      const total = Math.max(0, base - arrivalDiscount - earlyDiscount + accommodation)
      rows.push({ label: t('total'), value: `${total} CZK`, emphasis: true })
    }
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
