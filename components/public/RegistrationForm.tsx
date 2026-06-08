'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Controller,
  useFieldArray,
  useForm,
  type FieldPath,
  type Resolver,
  type UseFormRegister,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale, useTranslations } from 'next-intl'
import {
  calculatePriceSchema,
  registrationSubmitSchema,
  type RegistrationSubmitInput,
} from '@/lib/validation'
import { getAvailableMealIds } from '@/lib/utils/mealAvailability'
import { useDebounce } from '@/lib/utils/useDebounce'
import type {
  MockCenter,
  MockEventDate,
  MockMealSlot,
} from '@/lib/mock/registrationOptions'

// gdprConsent is `z.literal(true)` in the schema, but the checkbox must start
// unchecked — so the form's working type loosens just that one field to boolean.
// The zodResolver still enforces literal-true on submit (invariant 18 honeypot +
// GDPR). Everything else mirrors the schema's inferred type exactly.
type RegistrationFormValues = Omit<RegistrationSubmitInput, 'gdprConsent'> & {
  gdprConsent: boolean
}

// Shape we read from /calculate-price. The stub returns { totalPrice: 0,
// participants: [] }; real per-participant fields arrive in B7. Read-only.
type PriceResponse = {
  totalPrice: number
  participants: Array<{
    participationPrice?: number
    mealPrice?: number
    subtotal?: number
  }>
}

type Props = {
  eventId: string
  dates: MockEventDate[]
  meals: MockMealSlot[]
  centers: MockCenter[]
}

const AGE_CATEGORIES = ['AGE_0_3', 'AGE_4_7', 'AGE_8_14', 'AGE_15_PLUS'] as const
const PRICING_TYPES = ['STANDARD', 'SUPPORTED', 'SURPLUS'] as const
const ARRIVAL_TIMES = ['MORNING', 'AFTERNOON', 'EVENING'] as const
const EARLY_DEPARTURE = ['NONE', 'AFTER_BREAKFAST'] as const
const MAX_PARTICIPANTS = 10

const ageLabelKey: Record<string, string> = {
  AGE_0_3: 'age_0_3',
  AGE_4_7: 'age_4_7',
  AGE_8_14: 'age_8_14',
  AGE_15_PLUS: 'age_15_plus',
}
const pricingLabelKey: Record<string, string> = {
  STANDARD: 'price_standard',
  SUPPORTED: 'price_supported',
  SURPLUS: 'price_surplus',
}
const arrivalLabelKey: Record<string, string> = {
  MORNING: 'arrival_morning',
  AFTERNOON: 'arrival_afternoon',
  EVENING: 'arrival_evening',
}
const earlyLabelKey: Record<string, string> = {
  NONE: 'early_none',
  AFTER_BREAKFAST: 'early_after_breakfast',
}
const mealLabelKey: Record<string, string> = {
  BREAKFAST: 'meal_breakfast',
  LUNCH: 'meal_lunch',
  DINNER: 'meal_dinner',
}

function makeParticipant(): RegistrationFormValues['participants'][number] {
  return { fullName: '', ageCategory: 'AGE_15_PLUS', pricingType: 'STANDARD', mealIds: [] }
}

function formatCzk(value: number): string {
  return `${value} CZK`
}

export default function RegistrationForm({ eventId, dates, meals, centers }: Props) {
  const t = useTranslations('form')
  const locale = useLocale()

  const sortedDates = useMemo(
    () => [...dates].sort((a, b) => a.sortOrder - b.sortOrder),
    [dates],
  )
  const dateLabelById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const d of dates) map[d.id] = locale === 'cs' ? d.label_cs : d.label_en
    return map
  }, [dates, locale])

  const firstDateId = sortedDates[0]?.id ?? ''
  const lastDateId = sortedDates[sortedDates.length - 1]?.id ?? ''

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationFormValues, unknown, RegistrationSubmitInput>({
    // Boundary cast: the schema's input type pins gdprConsent to `true`
    // (z.literal(true)), but the checkbox must start unchecked. The form works
    // in RegistrationFormValues (gdprConsent: boolean) and the resolver still
    // enforces literal-true, producing RegistrationSubmitInput on submit.
    resolver: zodResolver(registrationSubmitSchema) as unknown as Resolver<
      RegistrationFormValues,
      unknown,
      RegistrationSubmitInput
    >,
    defaultValues: {
      eventId,
      arrivalDateId: firstDateId,
      arrivalTime: 'MORNING',
      departureDateId: lastDateId,
      earlyDeparture: 'NONE',
      hasAccommodation: false,
      honeypot: '',
      idempotencyKey: '',
      centerId: centers[0]?.id ?? '',
      email: '',
      gdprConsent: false,
      participants: [makeParticipant()],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'participants' })

  const [price, setPrice] = useState<PriceResponse | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // idempotencyKey (invariant 14): generated client-side on mount to avoid an
  // SSR/CSR hydration mismatch — kept in form state, never rendered to the DOM.
  useEffect(() => {
    setValue('idempotencyKey', crypto.randomUUID())
  }, [setValue])

  // ─── Dynamic meal availability by stay (recomputed on every §1 change) ───
  const arrivalDateId = watch('arrivalDateId')
  const arrivalTime = watch('arrivalTime')
  const departureDateId = watch('departureDateId')
  const earlyDeparture = watch('earlyDeparture')

  const availableMealIds = useMemo(
    () =>
      getAvailableMealIds(
        { arrivalDateId, arrivalTime, departureDateId, earlyDeparture },
        dates,
        meals,
      ),
    [arrivalDateId, arrivalTime, departureDateId, earlyDeparture, dates, meals],
  )

  // When the stay changes, drop any now-unavailable meal from every participant
  // so form state never holds a meal the person isn't present for.
  useEffect(() => {
    const parts = getValues('participants')
    parts.forEach((p, i) => {
      const current = p.mealIds ?? []
      const filtered = current.filter((id) => availableMealIds.has(id))
      if (filtered.length !== current.length) {
        setValue(`participants.${i}.mealIds`, filtered, { shouldDirty: true })
      }
    })
  }, [availableMealIds, getValues, setValue])

  // ─── Debounced server price call (presentation only — no client math) ───
  const allValues = watch()
  const calcPayload = {
    eventId: allValues.eventId,
    arrivalDateId: allValues.arrivalDateId,
    arrivalTime: allValues.arrivalTime,
    departureDateId: allValues.departureDateId,
    earlyDeparture: allValues.earlyDeparture,
    hasAccommodation: allValues.hasAccommodation,
    honeypot: allValues.honeypot ?? '',
    participants: (allValues.participants ?? []).map((p) => ({
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealIds: p.mealIds ?? [],
    })),
  }
  const debouncedCalcKey = useDebounce(JSON.stringify(calcPayload), 400)

  useEffect(() => {
    // Pre-validate with the same schema the endpoint uses; skip silently while
    // the draft isn't minimally valid (it would 422). Never compute price here.
    const parsed = calculatePriceSchema.safeParse(JSON.parse(debouncedCalcKey))
    if (!parsed.success) return

    let cancelled = false
    setPriceLoading(true)
    fetch('/api/registration/calculate-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    })
      .then((res) => (res.ok ? (res.json() as Promise<PriceResponse>) : Promise.reject(new Error('price call failed'))))
      .then((data) => {
        if (!cancelled) setPrice(data)
      })
      .catch(() => {
        /* stub or transient error — keep the last good price, surface nothing */
      })
      .finally(() => {
        if (!cancelled) setPriceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedCalcKey])

  // Age drives the pricing-type field: it exists only for 15+ and must be
  // cleared (invariant 15 / schema refinement) when the age leaves 15+.
  function handleAgeChange(index: number, value: string) {
    setValue(
      `participants.${index}.pricingType`,
      value === 'AGE_15_PLUS' ? 'STANDARD' : undefined,
      { shouldDirty: true },
    )
  }

  const onSubmit = () => {
    // B5 scope: do NOT POST to /api/registration/submit (wired in B7).
    setSubmitted(true)
  }

  const totalPrice = price?.totalPrice ?? 0

  if (submitted) {
    return (
      <div className="mt-8 section-card text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-100 text-success-700 text-2xl">
          ✓
        </div>
        <p className="mt-4 font-serif text-xl font-semibold text-neutral-900">
          {t('registration_success')}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-6 pb-28 md:pb-0" noValidate>
      {/* ─── §1 Stay ─── */}
      <section className="section-card">
        <SectionHeading>{t('section_stay')}</SectionHeading>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
          <Field label={t('arrival_date')}>
            <PillRadioGroup
              name="arrivalDateId"
              options={sortedDates.map((d) => d.id)}
              labelFor={(id) => dateLabelById[id] ?? id}
              register={register}
            />
          </Field>
          <Field label={t('arrival_time')}>
            <PillRadioGroup
              name="arrivalTime"
              options={ARRIVAL_TIMES}
              labelFor={(v) => t(arrivalLabelKey[v] ?? v)}
              register={register}
            />
          </Field>
          <Field label={t('departure_date')}>
            <PillRadioGroup
              name="departureDateId"
              options={sortedDates.map((d) => d.id)}
              labelFor={(id) => dateLabelById[id] ?? id}
              register={register}
            />
          </Field>
          <Field label={t('early_departure')}>
            <PillRadioGroup
              name="earlyDeparture"
              options={EARLY_DEPARTURE}
              labelFor={(v) => t(earlyLabelKey[v] ?? v)}
              register={register}
            />
          </Field>
          <Field label={t('accommodation')}>
            <Controller
              control={control}
              name="hasAccommodation"
              render={({ field }) => (
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: false, key: 'no' },
                    { value: true, key: 'yes' },
                  ].map((opt) => {
                    const domId = `accommodation-${opt.key}`
                    return (
                      <div key={opt.key}>
                        <input
                          type="radio"
                          id={domId}
                          className="peer sr-only"
                          checked={field.value === opt.value}
                          onBlur={field.onBlur}
                          onChange={() => field.onChange(opt.value)}
                        />
                        <label htmlFor={domId} className="pill-label cursor-pointer">
                          {t(opt.key)}
                        </label>
                      </div>
                    )
                  })}
                </div>
              )}
            />
          </Field>
        </div>
      </section>

      {/* ─── §2 Participants ─── */}
      <section className="section-card">
        <div className="flex items-center justify-between">
          <SectionHeading className="mb-0">{t('section_participants')}</SectionHeading>
          <span className="text-sm text-neutral-500 tabular-nums">
            {fields.length}/{MAX_PARTICIPANTS}
          </span>
        </div>

        <div className="mt-5 space-y-4">
          {fields.map((field, i) => {
            const age = allValues.participants?.[i]?.ageCategory
            const showPricingType = age === 'AGE_15_PLUS'
            const pricing = price?.participants?.[i]

            return (
              <div key={field.id} className="participant-card">
                <div className="flex items-center justify-between">
                  <p className="font-serif text-lg font-semibold text-neutral-900">
                    {t('participant_number', { number: i + 1 })}
                  </p>
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="text-sm font-medium text-danger-600 hover:text-danger-700 transition"
                    >
                      {t('remove_participant')}
                    </button>
                  )}
                </div>

                <div className="mt-4 form-field">
                  <label className="form-label" htmlFor={`fullName-${i}`}>
                    {t('full_name')}
                  </label>
                  <input
                    id={`fullName-${i}`}
                    type="text"
                    className="bdc-input"
                    autoComplete="off"
                    {...register(`participants.${i}.fullName`)}
                  />
                  {errors.participants?.[i]?.fullName && (
                    <p className="mt-1 text-sm text-danger-600">{t('errors.fullName')}</p>
                  )}
                </div>

                <Field label={t('age_category')}>
                  <PillRadioGroup
                    name={`participants.${i}.ageCategory`}
                    options={AGE_CATEGORIES}
                    labelFor={(v) => t(ageLabelKey[v] ?? v)}
                    register={register}
                    onPick={(v) => handleAgeChange(i, v)}
                  />
                </Field>

                {showPricingType && (
                  <Field label={t('price_type')}>
                    <PillRadioGroup
                      name={`participants.${i}.pricingType`}
                      options={PRICING_TYPES}
                      labelFor={(v) => t(pricingLabelKey[v] ?? v)}
                      register={register}
                    />
                  </Field>
                )}

                <Field label={t('meals')}>
                  <div className="space-y-3">
                    {sortedDates.map((d) => {
                      const slots = meals.filter(
                        (m) => m.eventDateId === d.id && availableMealIds.has(m.id),
                      )
                      if (slots.length === 0) return null
                      return (
                        <div key={d.id}>
                          <p className="text-sm font-medium text-neutral-600">
                            {dateLabelById[d.id]}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {slots.map((slot) => {
                              const domId = `meal-${i}-${slot.id}`
                              return (
                                <div key={slot.id}>
                                  <input
                                    type="checkbox"
                                    id={domId}
                                    value={slot.id}
                                    disabled={slot.isClosed}
                                    className="peer sr-only"
                                    {...register(`participants.${i}.mealIds`)}
                                  />
                                  <label
                                    htmlFor={domId}
                                    className={`pill-label ${
                                      slot.isClosed
                                        ? 'cursor-not-allowed opacity-50'
                                        : 'cursor-pointer'
                                    }`}
                                  >
                                    {t(mealLabelKey[slot.mealType] ?? slot.mealType)} ·{' '}
                                    {formatCzk(slot.price)}
                                    {slot.isClosed && ` (${t('meal_closed')})`}
                                  </label>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Field>

                {/* Read-only prices — server-authoritative (invariant 3) */}
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {t('pricing_info')}
                  </p>
                  <PriceRow label={t('participation_price')} value={pricing?.participationPrice ?? 0} />
                  <PriceRow label={t('meal_price')} value={pricing?.mealPrice ?? 0} />
                  <PriceRow label={t('participant_subtotal')} value={pricing?.subtotal ?? 0} />
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => append(makeParticipant())}
          disabled={fields.length >= MAX_PARTICIPANTS}
          className="btn-secondary mt-4 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('add_participant')}
        </button>
      </section>

      {/* ─── §3 Contact / other ─── */}
      <section className="section-card">
        <SectionHeading>{t('section_contact')}</SectionHeading>

        <div className="form-field">
          <label className="form-label" htmlFor="centerId">
            {t('center')}
          </label>
          <select id="centerId" className="bdc-input" {...register('centerId')}>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {locale === 'cs' ? c.name_cs : c.name_en}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="email">
            {t('email')}
          </label>
          <input id="email" type="email" className="bdc-input" {...register('email')} />
          {errors.email && <p className="mt-1 text-sm text-danger-600">{t('errors.email')}</p>}
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-neutral-300 accent-primary-500"
            {...register('gdprConsent')}
          />
          <span className="text-sm text-neutral-700">{t('gdpr_consent')}</span>
        </label>
        {errors.gdprConsent && <p className="mt-1 text-sm text-danger-600">{t('errors.gdpr')}</p>}

        {/* Honeypot (invariant 18) — RHF field key must be `honeypot`; hidden. */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ display: 'none' }}
          {...register('honeypot')}
        />
      </section>

      {/* ─── §4 Submit ─── */}
      <section className="section-card text-center">
        <p className="text-sm font-medium text-neutral-600">{t('amount_due')}</p>
        <p className="mt-1 font-serif text-4xl font-semibold tabular-nums text-primary-600">
          {formatCzk(totalPrice)}
        </p>
        {priceLoading && (
          <p className="mt-1 text-xs text-neutral-400">{t('calculating')}</p>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('register')}
        </button>
      </section>

      {/* Sticky running total on mobile */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-neutral-200 bg-white/95 px-5 py-3 backdrop-blur md:hidden">
        <span className="text-sm text-neutral-600">{t('amount_due')}</span>
        <span className="font-mono text-lg tabular-nums text-primary-600">
          {formatCzk(totalPrice)}
        </span>
      </div>
    </form>
  )
}

// ─── Small presentational helpers (same file, design-system classes only) ───

function SectionHeading({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`mb-5 ${className}`}>
      <h2 className="font-serif text-xl font-semibold text-neutral-900">{children}</h2>
      <div className="mt-2 h-0.5 w-10 rounded bg-primary-500" />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-field">
      <span className="form-label">{label}</span>
      {children}
    </div>
  )
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="price-field">
      <span className="text-sm text-neutral-700">{label}</span>
      <span className="price-amount">{formatCzk(value)}</span>
    </div>
  )
}

// Custom radio group: a visually-hidden `peer` input + `pill-label` (design
// system). Each input/label pair is wrapped so the `peer-checked` sibling
// selector stays scoped to its own option.
function PillRadioGroup({
  name,
  options,
  labelFor,
  register,
  onPick,
}: {
  name: FieldPath<RegistrationFormValues>
  options: readonly string[]
  labelFor: (value: string) => string
  register: UseFormRegister<RegistrationFormValues>
  onPick?: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const domId = `${name}-${opt}`
        const reg = register(name)
        return (
          <div key={opt}>
            <input
              type="radio"
              id={domId}
              value={opt}
              className="peer sr-only"
              {...reg}
              onChange={(e) => {
                reg.onChange(e)
                onPick?.(opt)
              }}
            />
            <label htmlFor={domId} className="pill-label cursor-pointer">
              {labelFor(opt)}
            </label>
          </div>
        )
      })}
    </div>
  )
}
