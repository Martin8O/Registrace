'use client'

import { useTranslations } from 'next-intl'
import type { EventMealDTO, PricingRuleDTO } from '@/modules/events'

type Props = {
  isOpen: boolean
  onClose: () => void
  meals: EventMealDTO[]
  pricingRules: PricingRuleDTO[]
}

type PricingRow = {
  label: string
  value: string
}

export default function PricingModal({ isOpen, onClose, meals, pricingRules }: Props) {
  const t = useTranslations('event.pricingModal')

  if (!isOpen) return null

  // Informational overview only (invariant 3) — one representative price per
  // meal type (first open slot), discounts/night from the 15+ STANDARD rule.
  const mealPrice = (type: string): number | undefined => {
    const slot =
      meals.find((m) => m.mealType === type && !m.isClosed) ??
      meals.find((m) => m.mealType === type)
    return slot?.price
  }
  const rule = (age: string, type = 'STANDARD'): PricingRuleDTO | undefined =>
    pricingRules.find((r) => r.ageCategory === age && r.pricingType === type)
  const std15 = rule('AGE_15_PLUS')

  const rows: PricingRow[] = []
  const push = (label: string, value: number | undefined): void => {
    if (value !== undefined) rows.push({ label, value: `${value} CZK` })
  }
  push(t('breakfast'), mealPrice('BREAKFAST'))
  push(t('lunch'), mealPrice('LUNCH'))
  push(t('dinner'), mealPrice('DINNER'))
  push(t('dailyRate.age03'), rule('AGE_0_3')?.dailyRate)
  push(t('dailyRate.age47'), rule('AGE_4_7')?.dailyRate)
  push(t('dailyRate.age814'), rule('AGE_8_14')?.dailyRate)
  push(t('dailyRate.age15standard'), std15?.dailyRate)
  push(t('dailyRate.age15supported'), rule('AGE_15_PLUS', 'SUPPORTED')?.dailyRate)
  push(t('dailyRate.age15surplus'), rule('AGE_15_PLUS', 'SURPLUS')?.dailyRate)
  push(t('eveningArrivalDiscount'), std15?.eveningArrivalDiscount)
  push(t('earlyDepartureDiscount'), std15?.earlyDepartureDiscount)
  push(t('pricePerNight'), std15?.nightRate)

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
          <h2 className="font-serif text-2xl font-semibold text-neutral-900">{t('title')}</h2>
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

        <div className="rounded-lg border border-neutral-200 overflow-hidden">
          {rows.map((row, i) => (
            <div
              key={row.label}
              className={`flex items-center justify-between px-4 py-2.5 ${
                i % 2 === 0 ? 'bg-white' : 'bg-stone-50'
              }`}
            >
              <span className="text-sm text-neutral-700">{row.label}</span>
              <span className="font-mono text-[15px] text-primary-600 tabular-nums">
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 text-right">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
