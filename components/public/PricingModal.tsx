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
  // The event's two independent tier sets (invariant 22). Each table is filtered
  // by its OWN set, never the other's — an event that tiers the stay but quotes a
  // single meal price must not advertise three meal tiers.
  participationPricingTypes: string[]
  mealPricingTypes: string[]
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

type Row = { key: string; label: string; values: number[] }
// A table after the all-zero rows and columns have been dropped: the columns that
// survived, and the rows built over exactly those columns.
type Table = { columns: string[]; rows: Row[] }

// The tiers one half of the price is actually offered on. An EMPTY set means "all
// three" — the same reading the submit service and the registration form use, so
// a data anomaly cannot make the overview disagree with what the form accepts.
function offeredTiers(set: string[]): readonly string[] {
  const offered = TIERS.filter((t) => set.includes(t))
  return offered.length > 0 ? offered : TIERS
}

// Informational overview only (invariant 3) — the server price is authoritative.
//
// Both halves are a matrix of age category × pricing tier, so the flat label/value
// list this used to be could not represent them: it showed one price per meal and
// only the 15+ daily rates, which since M37 is a single column of a 12-row table.
//
// Only what the event actually charges is listed. A price of 0 IS an answer — but a
// whole row of them is not an answer worth a line: a Těnovice weekend charges no
// participation below 15 and feeds the 0–3s for free, and printing those as four
// columns of "0 CZK" buried the two numbers that matter. So:
//   • a COLUMN priced 0 for every category and every tier is dropped whole — an
//     event with no paid programme has no daily rate to show, only a rate per night;
//   • a CATEGORY free on every tier the event offers is dropped whole — free is
//     then said by the category's absence from the price list, exactly as it is for
//     a meal the event does not serve at all.
// Both are all-or-nothing on purpose. A category priced on one tier and free on
// another keeps ALL its rows, including the free one: dropping just that row would
// read as "standard is missing" rather than "standard is free", which is the older
// failure this replaces, one level down. If everything is free the table empties and
// says so in words ("Bez poplatku.") rather than as a grid of zeros.
//
// What is also noise is repeating an identical price under three tier headings, so a
// category whose tiers are all equal collapses to a single row labelled by age alone
// (which is every category on an event that does not differentiate, e.g. any event
// predating the price list).
//
// Each table lists only the tiers ITS half is offered on (invariant 22), so a stay
// tiered three ways alongside a single meal price reads as three rows per age in
// the first table and one per age in the second. A half offered on one tier alone
// therefore collapses to age-only rows through the existing rule above — no special
// case is needed for it.
export default function PricingModal({
  isOpen,
  onClose,
  meals,
  pricingRules,
  mealPricingRules,
  participationPricingTypes,
  mealPricingTypes,
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
    resolveMealPrice(type, { ageCategory: age, mealPricingType: tier }, mealPricingRules, flatPriceFor(type))

  // The whole price matrix for one half, trimmed to what the event charges (see the
  // header) and then collapsed by tier where the tiers agree.
  const buildTable = (
    columns: string[],
    tiers: readonly string[],
    valuesFor: (age: string, tier: string) => number[],
  ): Table => {
    const matrix = AGES.map((age) => tiers.map((tier) => ({ tier, values: valuesFor(age, tier) })))

    // Column kept only if SOMETHING in it is priced. Dropping a column can never
    // turn a paid category into a free one — the column it removes was 0 in every
    // row — so the two filters are independent and their order does not matter.
    const columnKept = columns.map((_, ci) =>
      matrix.some((perTier) => perTier.some((x) => (x.values[ci] ?? 0) !== 0)),
    )
    const keep = (values: number[]) => values.filter((_, ci) => columnKept[ci])

    const rows = AGES.flatMap((age, ai) => {
      const perTier = matrix[ai]!.map((x) => ({ tier: x.tier, values: keep(x.values) }))
      // Free on every offered tier — the category is simply not part of this
      // event's price list. (With every column dropped this is true of all of
      // them, so the table empties and the "no charge" line takes over.)
      if (perTier.every((x) => x.values.every((v) => v === 0))) return []

      const allSame = perTier.every(
        (x) => JSON.stringify(x.values) === JSON.stringify(perTier[0]!.values),
      )
      if (allSame) {
        return [{ key: age, label: t(`age.${ageKey[age]}`), values: perTier[0]!.values }]
      }
      return perTier.map((x) => ({
        key: `${age}|${x.tier}`,
        label: `${t(`age.${ageKey[age]}`)} · ${t(`tier.${tierKey[x.tier]}`)}`,
        values: x.values,
      }))
    })

    return { columns: columns.filter((_, ci) => columnKept[ci]), rows }
  }

  const stayTable = buildTable(
    [t('dailyRateShort'), t('pricePerNightShort')],
    offeredTiers(participationPricingTypes),
    (age, tier) => {
      const r = rule(age, tier)
      return [r?.dailyRate ?? 0, r?.nightRate ?? 0]
    },
  )

  const mealTable = buildTable(
    servedMeals.map((type) => t(mealKey[type] ?? type)),
    offeredTiers(mealPricingTypes),
    (age, tier) => servedMeals.map((type) => mealPrice(type, age, tier)),
  )

  // Discounts stay a 15+ concept (child rules carry 0) — but they are NOT the same
  // across tiers. Nine of twelve live events discount a supported arrival less than
  // a standard one, and listing only the standard figures quoted every supported
  // visitor a discount they do not get. So the same rule the tables use applies
  // here: identical across the offered tiers collapses to one plain list, and
  // otherwise each tier gets its own row.
  const discountKinds = [
    { label: t('morningArrivalDiscount'), of: (r?: PricingRuleDTO) => r?.morningArrivalDiscount ?? 0 },
    { label: t('afternoonArrivalDiscount'), of: (r?: PricingRuleDTO) => r?.afternoonArrivalDiscount ?? 0 },
    { label: t('eveningArrivalDiscount'), of: (r?: PricingRuleDTO) => r?.eveningArrivalDiscount ?? 0 },
    { label: t('earlyDepartureDiscount'), of: (r?: PricingRuleDTO) => r?.earlyDepartureDiscount ?? 0 },
  ]
  const discountTiers = offeredTiers(participationPricingTypes)
  // Only the kinds this event actually gives on some offered tier — a row of
  // zeros here is noise, unlike in the price tables where 0 is a real answer.
  const shownKinds = discountKinds.filter((k) =>
    discountTiers.some((tier) => k.of(rule('AGE_15_PLUS', tier)) > 0),
  )
  const perTierDiscounts = discountTiers.map((tier) => ({
    tier,
    values: shownKinds.map((k) => k.of(rule('AGE_15_PLUS', tier))),
  }))
  const discountsIdentical = perTierDiscounts.every(
    (x) => JSON.stringify(x.values) === JSON.stringify(perTierDiscounts[0]!.values),
  )
  const discounts = discountsIdentical
    ? shownKinds.map((k, i) => ({ label: k.label, value: perTierDiscounts[0]!.values[i]! }))
    : []
  const discountRows: Row[] = discountsIdentical
    ? []
    : perTierDiscounts.map((x) => ({
        key: x.tier,
        label: t(`tier.${tierKey[x.tier]}`),
        values: x.values,
      }))

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

        <PriceTable title={t('stayTitle')} columns={stayTable.columns} rows={stayTable.rows} />

        {servedMeals.length > 0 && (
          <PriceTable
            title={t('mealsTitle')}
            columns={mealTable.columns}
            rows={mealTable.rows}
            className="mt-6"
          />
        )}

        {discountRows.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-neutral-900">{t('discountsTitle')}</h3>
            <p className="mt-1 mb-2 text-xs text-neutral-500">{t('discountsNote')}</p>
            <PriceTable
              categoryLabel={t('tierColumn')}
              columns={shownKinds.map((k) => k.label)}
              rows={discountRows}
              negative
            />
          </div>
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
  className = '',
  categoryLabel,
  negative = false,
}: {
  // Omitted when the caller renders its own heading (the discount table puts an
  // explanatory line between the heading and the table).
  title?: string
  columns: string[]
  rows: Array<{ key: string; label: string; values: number[] }>
  className?: string
  // Header of the first column — "Kategorie" for a price table, the tier for the
  // discount one. `negative` renders each amount as a deduction (invariant: every
  // *Discount field is SUBTRACTED from the total).
  categoryLabel?: string
  negative?: boolean
}) {
  const t = useTranslations('event.pricingModal')

  return (
    <div className={className}>
      {title !== undefined && (
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      )}
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">{t('free')}</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-stone-100">
                <th className="px-4 py-2 text-left font-semibold text-neutral-700">
                  {categoryLabel ?? t('categoryColumn')}
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
                <tr key={row.key} className={i % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                  <td className="px-4 py-2 text-neutral-700">{row.label}</td>
                  {row.values.map((v, vi) => (
                    <td
                      key={columns[vi] ?? vi}
                      className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums text-primary-600"
                    >
                      {negative ? '−' : ''}{v} CZK
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
