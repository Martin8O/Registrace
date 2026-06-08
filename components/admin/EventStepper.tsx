'use client'

import { useState } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { eventCreateSchema, type EventCreateInput } from '@/lib/validation'
import type { MealType } from '@/lib/mock/registrationOptions'
import type {
  MockAgeCategory,
  MockPricingType,
} from '@/lib/mock/registrations'

// ── Scalar fields covered by eventCreateSchema (the only schema-bound part). ──
// Dates / pricing / meals (steps 2–4) are UI-only state for B7 and never touch
// the schema (constraint: never redefine/extend a validation schema).
type EventFormValues = {
  title_cs: string
  title_en: string
  subtitle_cs: string
  subtitle_en: string
  contactName: string
  contactPhone: string
  contactEmail: string
  startDate: string
  endDate: string
  maxRegistrations?: number
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED'
}

// ── UI-only drafts (step 2–4) — collected for B7, not validated/persisted. ──
type EventDateDraft = { id: string; label_cs: string; label_en: string }
type Pricing15 = {
  dailyRate: number
  nightRate: number
  morningArrivalDiscount: number
  afternoonArrivalDiscount: number
  eveningArrivalDiscount: number
  earlyDepartureDiscount: number
}
type MealDraft = {
  id: string
  eventDateId: string
  mealType: MealType
  price: number
  label_cs: string
  label_en: string
  isClosed: boolean
}

const STEP_KEYS = [
  'basic',
  'schedule',
  'pricing',
  'meals',
  'settings',
  'preview',
  'save',
] as const

const STATUSES: EventFormValues['status'][] = [
  'DRAFT',
  'PUBLISHED',
  'CLOSED',
  'ARCHIVED',
]
const CHILD_AGES: MockAgeCategory[] = ['AGE_0_3', 'AGE_4_7', 'AGE_8_14']
const PRICING_TYPES: MockPricingType[] = ['STANDARD', 'SUPPORTED', 'SURPLUS']
const MEAL_TYPES: MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER']
const PRICING15_FIELDS: (keyof Pricing15)[] = [
  'dailyRate',
  'nightRate',
  'morningArrivalDiscount',
  'afternoonArrivalDiscount',
  'eveningArrivalDiscount',
  'earlyDepartureDiscount',
]

// Which step a schema field lives on — so a failed final validation can jump
// back to the earliest offending step.
const FIELD_STEP: Record<keyof EventFormValues, number> = {
  title_cs: 0,
  title_en: 0,
  subtitle_cs: 0,
  subtitle_en: 0,
  contactName: 0,
  contactPhone: 0,
  contactEmail: 0,
  startDate: 1,
  endDate: 1,
  maxRegistrations: 4,
  status: 4,
}

const emptyPricing15 = (): Pricing15 => ({
  dailyRate: 0,
  nightRate: 0,
  morningArrivalDiscount: 0,
  afternoonArrivalDiscount: 0,
  eveningArrivalDiscount: 0,
  earlyDepartureDiscount: 0,
})

export default function EventStepper() {
  const t = useTranslations('admin')

  const [step, setStep] = useState(0)
  const [saved, setSaved] = useState(false)

  // UI-only state (steps 2–4)
  const [dates, setDates] = useState<EventDateDraft[]>([])
  const [pricing15, setPricing15] = useState<Record<MockPricingType, Pricing15>>({
    STANDARD: emptyPricing15(),
    SUPPORTED: emptyPricing15(),
    SURPLUS: emptyPricing15(),
  })
  const [meals, setMeals] = useState<MealDraft[]>([])

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<EventFormValues, unknown, EventCreateInput>({
    // Boundary cast (mirrors RegistrationForm): the schema input pins coerced
    // dates / optional email, but the inputs are plain strings; the resolver
    // still enforces eventCreateSchema and yields EventCreateInput on submit.
    resolver: zodResolver(eventCreateSchema) as unknown as Resolver<
      EventFormValues,
      unknown,
      EventCreateInput
    >,
    defaultValues: {
      title_cs: '',
      title_en: '',
      subtitle_cs: '',
      subtitle_en: '',
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      startDate: '',
      endDate: '',
      maxRegistrations: undefined,
      status: 'DRAFT',
    },
  })

  // Localised inline error per schema field.
  function fieldError(name: keyof EventFormValues): string | null {
    const err = errors[name]
    if (!err) return null
    if (name === 'contactEmail') return t('eventForm.errors.email')
    if (name === 'endDate')
      return err.type === 'custom'
        ? t('eventForm.errors.endDate')
        : t('eventForm.errors.date')
    if (name === 'startDate') return t('eventForm.errors.date')
    if (name === 'maxRegistrations') return t('eventForm.errors.maxRegistrations')
    return t('eventForm.errors.required')
  }

  const onValid = () => {
    // B6 scope: validate only — do NOT POST and do NOT persist (mirrors B5).
    // TODO(B7): POST to /api/admin/events; set Event.createdBy from the session
    // (never the request body); persist dates/pricing/meals drafts too.
    setSaved(true)
  }
  // Use the errors RHF passes in — formState.errors hasn't re-rendered yet at
  // the moment this fires, so reading the closure would see stale (empty) data.
  const onInvalid = (errs: FieldErrors<EventFormValues>) => {
    const steps = Object.keys(errs).map(
      (k) => FIELD_STEP[k as keyof EventFormValues] ?? 0,
    )
    if (steps.length > 0) setStep(Math.min(...steps))
  }

  // ── Date / meal draft helpers ──
  const addDate = () =>
    setDates((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label_cs: '', label_en: '' },
    ])
  const removeDate = (id: string) => {
    setDates((prev) => prev.filter((d) => d.id !== id))
    setMeals((prev) => prev.filter((m) => m.eventDateId !== id))
  }
  const updateDate = (id: string, patch: Partial<EventDateDraft>) =>
    setDates((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const addMeal = (dateId: string) =>
    setMeals((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        eventDateId: dateId,
        mealType: 'BREAKFAST',
        price: 0,
        label_cs: '',
        label_en: '',
        isClosed: false,
      },
    ])
  const removeMeal = (id: string) =>
    setMeals((prev) => prev.filter((m) => m.id !== id))
  const updateMeal = (id: string, patch: Partial<MealDraft>) =>
    setMeals((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const updatePricing15 = (type: MockPricingType, patch: Partial<Pricing15>) =>
    setPricing15((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }))

  if (saved) {
    return (
      <div className="section-card text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-100 text-2xl text-success-700">
          ✓
        </div>
        <p className="mt-4 font-serif text-xl font-semibold text-neutral-900">
          {t('eventForm.saveSuccess')}
        </p>
      </div>
    )
  }

  const values = watch()

  return (
    <div className="space-y-6">
      {/* Step indicator (clickable — free navigation across all 7 steps) */}
      <div className="section-card">
        <p className="text-sm font-medium text-neutral-500">
          {t('eventForm.stepLabel', { current: step + 1, total: STEP_KEYS.length })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {STEP_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => setStep(i)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                i === step
                  ? 'bg-primary-500 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {i + 1}. {t(`eventForm.steps.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Step bodies ── */}
      {step === 0 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.basic')}</StepHeading>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <TextField label={t('eventForm.fields.title_cs')} error={fieldError('title_cs')}>
              <input className="bdc-input" {...register('title_cs')} />
            </TextField>
            <TextField label={t('eventForm.fields.title_en')} error={fieldError('title_en')}>
              <input className="bdc-input" {...register('title_en')} />
            </TextField>
            <TextField label={t('eventForm.fields.subtitle_cs')}>
              <input className="bdc-input" {...register('subtitle_cs')} />
            </TextField>
            <TextField label={t('eventForm.fields.subtitle_en')}>
              <input className="bdc-input" {...register('subtitle_en')} />
            </TextField>
            <TextField label={t('eventForm.fields.contactName')}>
              <input className="bdc-input" {...register('contactName')} />
            </TextField>
            <TextField label={t('eventForm.fields.contactPhone')}>
              <input className="bdc-input" {...register('contactPhone')} />
            </TextField>
            <TextField
              label={t('eventForm.fields.contactEmail')}
              error={fieldError('contactEmail')}
            >
              <input
                type="email"
                className="bdc-input"
                {...register('contactEmail', {
                  setValueAs: (v) => (v === '' || v == null ? undefined : v),
                })}
              />
            </TextField>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.schedule')}</StepHeading>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <TextField label={t('eventForm.fields.startDate')} error={fieldError('startDate')}>
              <input type="date" className="bdc-input" {...register('startDate')} />
            </TextField>
            <TextField label={t('eventForm.fields.endDate')} error={fieldError('endDate')}>
              <input type="date" className="bdc-input" {...register('endDate')} />
            </TextField>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                {t('eventForm.schedule.eventDates')}
              </h3>
              <button type="button" onClick={addDate} className="btn-secondary">
                {t('eventForm.schedule.addDate')}
              </button>
            </div>
            {dates.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">
                {t('eventForm.schedule.noDates')}
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {dates.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-stone-50 p-4 sm:flex-row sm:items-end"
                  >
                    <TextField label={t('eventForm.fields.dateLabelCs')} className="flex-1">
                      <input
                        className="bdc-input"
                        value={d.label_cs}
                        onChange={(e) => updateDate(d.id, { label_cs: e.target.value })}
                      />
                    </TextField>
                    <TextField label={t('eventForm.fields.dateLabelEn')} className="flex-1">
                      <input
                        className="bdc-input"
                        value={d.label_en}
                        onChange={(e) => updateDate(d.id, { label_en: e.target.value })}
                      />
                    </TextField>
                    <button
                      type="button"
                      onClick={() => removeDate(d.id)}
                      className="btn-secondary shrink-0"
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="section-card space-y-6">
          <StepHeading>{t('eventForm.steps.pricing')}</StepHeading>
          <p className="text-sm text-neutral-500">{t('eventForm.pricing.intro')}</p>

          {/* Children 0–14: dailyRate locked at 0, no pricingType (invariant 15) */}
          <div className="space-y-2">
            {CHILD_AGES.map((age) => (
              <div
                key={age}
                className="flex items-center justify-between rounded-lg bg-stone-200 px-4 py-2.5"
              >
                <span className="text-sm font-medium text-neutral-700">
                  {t(`age.${age}`)}
                </span>
                <span className="price-amount">
                  {t('eventForm.fields.dailyRate')}: 0
                </span>
              </div>
            ))}
            <p className="text-xs text-neutral-500">
              {t('eventForm.pricing.lockedZeroNote')}
            </p>
          </div>

          {/* 15+: three pricingType rows, each with rate + discount fields */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-neutral-900">
              {t('age.AGE_15_PLUS')}
            </h3>
            {PRICING_TYPES.map((type) => (
              <div
                key={type}
                className="rounded-xl border border-neutral-200 bg-stone-50 p-4"
              >
                <p className="mb-3 text-sm font-semibold text-primary-700">
                  {t(`pricingType.${type}`)}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {PRICING15_FIELDS.map((f) => (
                    <TextField key={f} label={t(`eventForm.fields.${f}`)}>
                      <input
                        type="number"
                        min={0}
                        className="bdc-input"
                        value={pricing15[type][f]}
                        onChange={(e) =>
                          updatePricing15(type, {
                            [f]: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </TextField>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.meals')}</StepHeading>
          <p className="text-sm text-neutral-500">{t('eventForm.meals.intro')}</p>

          {dates.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('eventForm.meals.noDates')}</p>
          ) : (
            <div className="space-y-5">
              {dates.map((d) => {
                const dayMeals = meals.filter((m) => m.eventDateId === d.id)
                return (
                  <div
                    key={d.id}
                    className="rounded-xl border border-neutral-200 bg-stone-50 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-neutral-900">
                        {t('eventForm.meals.forDate')}:{' '}
                        {d.label_cs || d.label_en || d.id.slice(0, 8)}
                      </p>
                      <button
                        type="button"
                        onClick={() => addMeal(d.id)}
                        className="btn-secondary"
                      >
                        {t('eventForm.meals.addMeal')}
                      </button>
                    </div>

                    {dayMeals.length > 0 && (
                      <div className="mt-3 space-y-3">
                        {dayMeals.map((m) => (
                          <div
                            key={m.id}
                            className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
                          >
                            <TextField label={t('eventForm.fields.mealType')}>
                              <select
                                className="bdc-input"
                                value={m.mealType}
                                onChange={(e) =>
                                  updateMeal(m.id, {
                                    mealType: e.target.value as MealType,
                                  })
                                }
                              >
                                {MEAL_TYPES.map((mt) => (
                                  <option key={mt} value={mt}>
                                    {t(`mealType.${mt}`)}
                                  </option>
                                ))}
                              </select>
                            </TextField>
                            <TextField label={t('eventForm.fields.price')}>
                              <input
                                type="number"
                                min={0}
                                className="bdc-input"
                                value={m.price}
                                onChange={(e) =>
                                  updateMeal(m.id, {
                                    price: Number(e.target.value) || 0,
                                  })
                                }
                              />
                            </TextField>
                            <TextField label={t('eventForm.fields.mealLabelCs')}>
                              <input
                                className="bdc-input"
                                value={m.label_cs}
                                onChange={(e) =>
                                  updateMeal(m.id, { label_cs: e.target.value })
                                }
                              />
                            </TextField>
                            <TextField label={t('eventForm.fields.mealLabelEn')}>
                              <input
                                className="bdc-input"
                                value={m.label_en}
                                onChange={(e) =>
                                  updateMeal(m.id, { label_en: e.target.value })
                                }
                              />
                            </TextField>
                            <div className="flex items-center justify-between gap-3">
                              <label className="flex items-center gap-2 text-sm text-neutral-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-primary-500"
                                  checked={m.isClosed}
                                  onChange={(e) =>
                                    updateMeal(m.id, { isClosed: e.target.checked })
                                  }
                                />
                                {t('eventForm.fields.isClosed')}
                              </label>
                              <button
                                type="button"
                                onClick={() => removeMeal(m.id)}
                                className="text-sm font-medium text-danger-600 hover:text-danger-700"
                              >
                                {t('common.remove')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {step === 4 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.settings')}</StepHeading>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <TextField
              label={t('eventForm.fields.maxRegistrations')}
              error={fieldError('maxRegistrations')}
            >
              <input
                type="number"
                min={1}
                className="bdc-input"
                {...register('maxRegistrations', {
                  setValueAs: (v) =>
                    v === '' || v == null ? undefined : Number(v),
                })}
              />
            </TextField>
            <TextField label={t('eventForm.fields.status')} error={fieldError('status')}>
              <select className="bdc-input" {...register('status')}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`eventStatus.${s}`)}
                  </option>
                ))}
              </select>
            </TextField>
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.preview')}</StepHeading>
          <p className="text-sm text-neutral-500">{t('eventForm.preview.intro')}</p>

          <PreviewBlock title={t('eventForm.preview.basic')}>
            <PreviewRow label={t('eventForm.fields.title_cs')} value={values.title_cs} />
            <PreviewRow label={t('eventForm.fields.title_en')} value={values.title_en} />
            <PreviewRow label={t('eventForm.fields.subtitle_cs')} value={values.subtitle_cs} />
            <PreviewRow label={t('eventForm.fields.subtitle_en')} value={values.subtitle_en} />
            <PreviewRow label={t('eventForm.fields.contactName')} value={values.contactName} />
            <PreviewRow label={t('eventForm.fields.contactPhone')} value={values.contactPhone} />
            <PreviewRow label={t('eventForm.fields.contactEmail')} value={values.contactEmail} />
          </PreviewBlock>

          <PreviewBlock title={t('eventForm.preview.schedule')}>
            <PreviewRow label={t('eventForm.fields.startDate')} value={values.startDate} />
            <PreviewRow label={t('eventForm.fields.endDate')} value={values.endDate} />
            {dates.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('eventForm.schedule.noDates')}</p>
            ) : (
              dates.map((d) => (
                <PreviewRow
                  key={d.id}
                  label={t('eventForm.schedule.eventDates')}
                  value={`${d.label_cs} / ${d.label_en}`}
                />
              ))
            )}
          </PreviewBlock>

          <PreviewBlock title={t('eventForm.preview.pricing')}>
            {PRICING_TYPES.map((type) => (
              <PreviewRow
                key={type}
                label={`${t('age.AGE_15_PLUS')} · ${t(`pricingType.${type}`)}`}
                value={PRICING15_FIELDS.map(
                  (f) => `${t(`eventForm.fields.${f}`)} ${pricing15[type][f]}`,
                ).join(' · ')}
              />
            ))}
          </PreviewBlock>

          <PreviewBlock title={t('eventForm.preview.meals')}>
            {meals.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('eventForm.preview.noMeals')}</p>
            ) : (
              meals.map((m) => (
                <PreviewRow
                  key={m.id}
                  label={t(`mealType.${m.mealType}`)}
                  value={`${m.price} CZK${m.isClosed ? ` · ${t('eventForm.fields.isClosed')}` : ''}`}
                />
              ))
            )}
          </PreviewBlock>

          <PreviewBlock title={t('eventForm.preview.settings')}>
            <PreviewRow
              label={t('eventForm.fields.maxRegistrations')}
              value={values.maxRegistrations != null ? String(values.maxRegistrations) : ''}
            />
            <PreviewRow
              label={t('eventForm.fields.status')}
              value={t(`eventStatus.${values.status}`)}
            />
          </PreviewBlock>
        </section>
      )}

      {step === 6 && (
        <section className="section-card space-y-4">
          <StepHeading>{t('eventForm.steps.save')}</StepHeading>
          {Object.keys(errors).length > 0 && (
            <div className="rounded-lg border border-danger-500/40 bg-danger-50 p-4">
              <p className="text-sm font-semibold text-danger-700">
                {t('eventForm.errorsTitle')}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger-600">
                {Object.keys(errors).map((k) => (
                  <li key={k}>
                    {t(`eventForm.fields.${k}`)}: {fieldError(k as keyof EventFormValues)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={handleSubmit(onValid, onInvalid)}
            className="btn-primary w-full"
          >
            {t('eventForm.save')}
          </button>
        </section>
      )}

      {/* ── Step nav ── */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('eventForm.prev')}
        </button>
        {step < STEP_KEYS.length - 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEP_KEYS.length - 1, s + 1))}
            className="btn-primary"
          >
            {t('eventForm.next')}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Local presentational helpers (design-system classes only) ──

function StepHeading({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-serif text-xl font-semibold text-neutral-900">{children}</h2>
      <div className="mt-2 h-0.5 w-10 rounded bg-primary-500" />
    </div>
  )
}

function TextField({
  label,
  error,
  className = '',
  children,
}: {
  label: string
  error?: string | null
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <span className="form-label">{label}</span>
      {children}
      {error && <p className="mt-1 text-sm text-danger-600">{error}</p>}
    </div>
  )
}

function PreviewBlock({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-stone-50 p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-900">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-900">{value || '—'}</span>
    </div>
  )
}
