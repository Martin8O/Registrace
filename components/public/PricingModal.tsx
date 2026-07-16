'use client'

import { useTranslations } from 'next-intl'
import { resolveMealPrice } from '@/lib/utils/mealPrice'
import type { EventMealDTO, MealPricingRuleDTO, PricingRuleDTO } from '@/modules/events'

type Props = {
  isOpen: boolean
  onClose: () => void
  meals: EventMealDTO[]
  pricingRules: PricingRuleDTO[]
  mealPricingRules: MealPricingRuleDTO[]
}

const AGES = ['AGE_0_3', 'AGE_4_7', 'AGE_8_14', 'AGE_15_PLUS'] as const
const TIERS = ['STANDARD', 'SUPPORTED', 'SURPLUS'] as const
const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'] as const

const ageKey: Record<string, string> = {
  AGE_0_3: 'age03',
  AGE_4_7: 'age47',
  AGE_8_14: 'age814',
  AGE_15_PLUS: 'age15',
}
const tierKey: Record<string, string> = {
  STANDARD: 'standard',
  SUPPORTED: 'supported',
  SURPLUS: 'surplus',
}
const mealKey: Record<string, string> = {
  BREAKFAST: 'breakfast',
  LUNCH: 'lunch',
  DINNER: 'dinner',
}

// Informational overview only (invariant 3) — the server price is authoritative.
//
// Both halves are now a matrix of age category × pricing tier, so the flat
// label/value list this used to be could not represent them: it showed one price
// per meal and only the 15+ daily rates, which since M37 is a single column of a
// 12-row table. Rows whose every value is 0 are dropped rather than rendered as a
// wall of zeros — most events charge nothing for young children, and printing
// "0 CZK" twelve times buries the numbers that do matter.
export default function PricingModal({
  isOpen,
  onClose,
  meals,
  pricingRules,
  mealPricingRules,
}: Props) {
  const t = useTranslations('event.pricingModal')

  if (!isOpen) return null

  const rule = (age: string, tier: string): PricingRuleDTO | undefined =>
    pricingRules.find((r) => r.ageCategory === age && r.pricingType === tier)

  // A meal type is listed only if the event actually serves it on some open slot.
  const servedMeals = MEAL_TYPES.filter((type) =>
    meals.some((m) => m.mealType === type && !m.isClosed),
  )
  const flatPriceFor = (type: string): number =>
    meals.find((m) => m.mealType === type && !m.isClosed)?.price ?? 0

  const mealPrice = (type: string, age: string, tier: string): number =>
    resolveMealPrice(type, { ageCategory: age, pricingType: tier }, mealPricingRules, flatPriceFor(type))

  // One row per (age, tier) that costs something — for participation and meals
  // independently, since an event may charge a child for meals but not for the stay.
  type Row = { age: string; tier: string; values: number[] }
  const buildRows = (valuesFor: (age: string, tier: string) => number[]): Row[] =>
    AGES.flatMap((age) =>
      TIERS.map((tier) => ({ age, tier, values: valuesFor(age, tier) })),
    ).filter((r) => r.values.some((v) => v > 0))

  const stayColumns = [t('dailyRateShort'), t('pricePerNightShort')]
  const stayRows = buildRows((age, tier) => {
    const r = rule(age, tier)
    return [r?.dailyRate ?? 0, r?.nightRate ?? 0]
  })

  const mealRows = buildRows((age, tier) =>
    servedMeals.map((type) => mealPrice(type, age, tier)),
  )

  // Discounts stay a 15+ concept (child rules carry 0), so they keep a plain list.
  const std15 = rule('AGE_15_PLUS', 'STANDARD')
  const discounts: Array<{ label: string; value: number }> = []
  const pushDiscount = (label: string, value: number | undefined) => {
    if (value !== undefined && value > 0) discounts.push({ label, value })
  }
  pushDiscount(t('morningArrivalDiscount'), std15?.morningArrivalDiscount)
  pushDiscount(t('afternoonArrivalDiscount'), std15?.afternoonArrivalDiscount)
  pushDiscount(t('eveningArrivalDiscount'), std15?.eveningArrivalDiscount)
  pushDiscount(t('earlyDepartureDiscount'), std15?.earlyDepartureDiscount)

  const label = (row: Row) => `${t(`age.${ageKey[row.age]}`)} · ${t(`tier.${tierKey[row.tier]}`)}`

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-7"
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

        <PriceTable title={t('stayTitle')} columns={stayColumns} rows={stayRows} label={label} />

        {servedMeals.length > 0 && (
          <PriceTable
            title={t('mealsTitle')}
            columns={servedMeals.map((type) => t(mealKey[type] ?? type))}
            rows={mealRows}
            label={label}
            className="mt-6"
          />
        )}

        {discounts.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-neutral-900">{t('discountsTitle')}</h3>
            <p className="mt-1 text-xs text-neutral-500">{t('discountsNote')}</p>
            <div className="mt-2 rounded-lg border border-neutral-200 overflow-hidden">
              {discounts.map((d, i) => (
                <div
                  key={d.label}
                  className={`flex items-center justify-between px-4 py-2.5 ${
                    i % 2 === 0 ? 'bg-white' : 'bg-stone-50'
                  }`}
                >
                  <span className="text-sm text-neutral-700">{d.label}</span>
                  <span className="font-mono text-[15px] text-primary-600 tabular-nums">
                    −{d.value} CZK
                  </span>
                </div>
              ))}
            </div>
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

function PriceTable({
  title,
  columns,
  rows,
  label,
  className = '',
}: {
  title: string
  columns: string[]
  rows: Array<{ age: string; tier: string; values: number[] }>
  label: (row: { age: string; tier: string; values: number[] }) => string
  className?: string
}) {
  const t = useTranslations('event.pricingModal')

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">{t('free')}</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-stone-100">
                <th className="px-4 py-2 text-left font-semibold text-neutral-700">
                  {t('categoryColumn')}
                </th>
                {columns.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap px-4 py-2 text-right font-semibold text-neutral-700"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.age}|${row.tier}`} className={i % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                  <td className="px-4 py-2 text-neutral-700">{label(row)}</td>
                  {row.values.map((v, vi) => (
                    <td
                      key={columns[vi] ?? vi}
                      className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums text-primary-600"
                    >
                      {v} CZK
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
