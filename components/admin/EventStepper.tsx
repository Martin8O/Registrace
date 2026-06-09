'use client'

import { useMemo, useState } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale, useTranslations } from 'next-intl'
import { eventCreateSchema, type EventCreateInput } from '@/lib/validation'
import { mockCenters } from '@/lib/mock/registrationOptions'
import type {
  MockAgeCategory,
  MockPricingType,
} from '@/lib/mock/registrations'
import {
  DEFAULT_MEAL_PRICE,
  MEAL_TYPES,
  enumerateEventDays,
  todayISO,
  type MealType,
} from '@/lib/utils/eventDays'

// Scalar fields covered by eventCreateSchema (the only schema-bound part). The
// schema is frozen, so the UI "Popis/Description" is bound to subtitle_cs/_en
// (relabelled). Center, derived event days, pricing, and meals are UI-only
// state for B7 — they never touch the schema.
type EventFormValues = {
  title_cs: string
  title_en: string
  subtitle_cs: string // rendered as "Popis / Description"
  subtitle_en: string
  contactName: string
  contactPhone: string
  contactEmail: string
  startDate: string
  endDate: string
  maxRegistrations?: number
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED'
}

export type EventStepperInitial = Partial<EventFormValues> & { centerId?: string }

type Pricing15 = {
  dailyRate: number
  nightRate: number
  morningArrivalDiscount: number
  afternoonArrivalDiscount: number
  eveningArrivalDiscount: number
  earlyDepartureDiscount: number
}
type MealEdit = { price: number; excluded: boolean }

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
const PRICING15_FIELDS: (keyof Pricing15)[] = [
  'dailyRate',
  'nightRate',
  'morningArrivalDiscount',
  'afternoonArrivalDiscount',
  'eveningArrivalDiscount',
  'earlyDepartureDiscount',
]

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

const mealKey = (date: string, meal: MealType) => `${date}|${meal}`

export default function EventStepper({
  initial,
}: {
  initial?: EventStepperInitial
}) {
  const t = useTranslations('admin')
  const locale = useLocale()

  const [step, setStep] = useState(0)
  const [saved, setSaved] = useState(false)
  const [didPublish, setDidPublish] = useState(false)
  const [publishModal, setPublishModal] = useState(false)

  // UI-only state
  const [centerId, setCenterId] = useState(initial?.centerId ?? '')
  const [pricing15, setPricing15] = useState<Record<MockPricingType, Pricing15>>({
    STANDARD: emptyPricing15(),
    SUPPORTED: emptyPricing15(),
    SURPLUS: emptyPricing15(),
  })
  const [mealEdits, setMealEdits] = useState<Record<string, MealEdit>>({})

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<EventFormValues, unknown, EventCreateInput>({
    resolver: zodResolver(eventCreateSchema) as unknown as Resolver<
      EventFormValues,
      unknown,
      EventCreateInput
    >,
    defaultValues: {
      title_cs: initial?.title_cs ?? '',
      title_en: initial?.title_en ?? '',
      subtitle_cs: initial?.subtitle_cs ?? '',
      subtitle_en: initial?.subtitle_en ?? '',
      contactName: initial?.contactName ?? '',
      contactPhone: initial?.contactPhone ?? '',
      contactEmail: initial?.contactEmail ?? '',
      startDate: initial?.startDate ?? '',
      endDate: initial?.endDate ?? '',
      maxRegistrations: initial?.maxRegistrations,
      status: initial?.status ?? 'DRAFT',
    },
  })

  const startDate = watch('startDate')
  const endDate = watch('endDate')

  // Event days are derived from the date range (admin picks only start + end).
  const days = useMemo(
    () => enumerateEventDays(startDate, endDate),
    [startDate, endDate],
  )

  const sortedCenters = useMemo(
    () => [...mockCenters].sort((a, b) => a.name_cs.localeCompare(b.name_cs, 'cs')),
    [],
  )

  // Start date cannot be in the past (not expressible in the frozen schema, so
  // enforced here + via the input's min).
  const startInPast = startDate !== '' && startDate < todayISO()

  function getMeal(date: string, meal: MealType): MealEdit {
    return mealEdits[mealKey(date, meal)] ?? { price: DEFAULT_MEAL_PRICE[meal], excluded: false }
  }
  function patchMeal(date: string, meal: MealType, patch: Partial<MealEdit>) {
    const key = mealKey(date, meal)
    const current = getMeal(date, meal)
    setMealEdits((prev) => ({ ...prev, [key]: { ...current, ...patch } }))
  }
  const updatePricing15 = (type: MockPricingType, patch: Partial<Pricing15>) =>
    setPricing15((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }))

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
    // (never the request body); persist center, days, pricing and meal drafts.
    setSaved(true)
  }
  const onInvalid = (errs: FieldErrors<EventFormValues>) => {
    const steps = Object.keys(errs).map(
      (k) => FIELD_STEP[k as keyof EventFormValues] ?? 0,
    )
    if (steps.length > 0) setStep(Math.min(...steps))
  }

  // Save flow. "Save and Publish" forces status=PUBLISHED. Publishing (either
  // way) asks for confirmation first.
  function attemptSave(forcePublish: boolean) {
    if (forcePublish) setValue('status', 'PUBLISHED')
    if (getValues('startDate') && getValues('startDate') < todayISO()) {
      setStep(1)
      return
    }
    const willPublish = forcePublish || getValues('status') === 'PUBLISHED'
    setDidPublish(willPublish)
    if (willPublish) {
      setPublishModal(true)
    } else {
      void handleSubmit(onValid, onInvalid)()
    }
  }
  function confirmPublish() {
    setPublishModal(false)
    void handleSubmit(onValid, onInvalid)()
  }

  if (saved) {
    return (
      <div className="section-card text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-100 text-2xl text-success-700">
          ✓
        </div>
        <p className="mt-4 font-serif text-xl font-semibold text-neutral-900">
          {didPublish ? t('eventForm.publishSuccess') : t('eventForm.saveSuccess')}
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

      {/* ── Step 1 · Basic info ── */}
      {step === 0 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.basic')}</StepHeading>

          <div>
            <label htmlFor="ev-center" className="form-label">
              {t('eventForm.fields.center')}
            </label>
            <select
              id="ev-center"
              className="bdc-input"
              value={centerId}
              onChange={(e) => setCenterId(e.target.value)}
            >
              <option value="">—</option>
              {sortedCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'cs' ? c.name_cs : c.name_en}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <TextField label={t('eventForm.fields.title_cs')} error={fieldError('title_cs')}>
              <input className="bdc-input" {...register('title_cs')} />
            </TextField>
            <TextField label={t('eventForm.fields.title_en')} error={fieldError('title_en')}>
              <input className="bdc-input" {...register('title_en')} />
            </TextField>
            <TextField label={t('eventForm.fields.description_cs')}>
              <textarea rows={2} className="bdc-input" {...register('subtitle_cs')} />
            </TextField>
            <TextField label={t('eventForm.fields.description_en')}>
              <textarea rows={2} className="bdc-input" {...register('subtitle_en')} />
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

      {/* ── Step 2 · Schedule (auto-derived days) ── */}
      {step === 1 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.schedule')}</StepHeading>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <TextField
              label={t('eventForm.fields.startDate')}
              error={
                startInPast
                  ? t('eventForm.errors.startInPast')
                  : fieldError('startDate')
              }
            >
              <input
                type="date"
                min={todayISO()}
                className="bdc-input"
                {...register('startDate')}
              />
            </TextField>
            <TextField label={t('eventForm.fields.endDate')} error={fieldError('endDate')}>
              <input
                type="date"
                min={startDate || todayISO()}
                className="bdc-input"
                {...register('endDate')}
              />
            </TextField>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              {t('eventForm.schedule.eventDays')}
            </h3>
            <p className="mt-1 text-sm text-neutral-500">
              {t('eventForm.schedule.derivedNote')}
            </p>
            {days.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">
                {t('eventForm.schedule.selectDates')}
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {days.map((d) => (
                  <li
                    key={d.date}
                    className="rounded-lg border border-neutral-200 bg-stone-50 px-3 py-1.5 text-sm text-neutral-700"
                  >
                    {locale === 'cs' ? d.label_cs : d.label_en}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ── Step 3 · Pricing (UI state; engine + defaults in B7) ── */}
      {step === 2 && (
        <section className="section-card space-y-6">
          <StepHeading>{t('eventForm.steps.pricing')}</StepHeading>
          <p className="text-sm text-neutral-500">{t('eventForm.pricing.intro')}</p>

          <div className="space-y-2">
            {CHILD_AGES.map((age) => (
              <div
                key={age}
                className="flex items-center justify-between rounded-lg bg-stone-200 px-4 py-2.5"
              >
                <span className="text-sm font-medium text-neutral-700">
                  {t(`age.${age}`)}
                </span>
                <span className="price-amount">{t('eventForm.fields.dailyRate')}: 0</span>
              </div>
            ))}
            <p className="text-xs text-neutral-500">
              {t('eventForm.pricing.lockedZeroNote')}
            </p>
          </div>

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
                          updatePricing15(type, { [f]: Number(e.target.value) || 0 })
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

      {/* ── Step 4 · Meals (all days × B/L/D, default prices, excludable) ── */}
      {step === 3 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.meals')}</StepHeading>
          <p className="text-sm text-neutral-500">{t('eventForm.meals.intro')}</p>

          {days.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('eventForm.meals.noDates')}</p>
          ) : (
            <div className="space-y-4">
              {days.map((d) => (
                <div
                  key={d.date}
                  className="rounded-xl border border-neutral-200 bg-stone-50 p-4"
                >
                  <p className="text-sm font-semibold text-neutral-900">
                    {t('eventForm.meals.forDate')}:{' '}
                    {locale === 'cs' ? d.label_cs : d.label_en}
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {MEAL_TYPES.map((meal) => {
                      const m = getMeal(d.date, meal)
                      return (
                        <div
                          key={meal}
                          className={`rounded-lg border bg-white p-3 ${
                            m.excluded ? 'border-neutral-200 opacity-60' : 'border-neutral-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-neutral-800">
                              {t(`mealType.${meal}`)}
                            </span>
                            {m.excluded && (
                              <span className="badge bg-neutral-200 text-neutral-600 border border-neutral-300">
                                {t('eventForm.meals.excluded')}
                              </span>
                            )}
                          </div>
                          <input
                            type="number"
                            min={0}
                            disabled={m.excluded}
                            className="bdc-input mt-2"
                            value={m.price}
                            onChange={(e) =>
                              patchMeal(d.date, meal, {
                                price: Number(e.target.value) || 0,
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              patchMeal(d.date, meal, { excluded: !m.excluded })
                            }
                            className={`mt-2 text-sm font-medium ${
                              m.excluded
                                ? 'text-primary-600 hover:text-primary-700'
                                : 'text-danger-600 hover:text-danger-700'
                            }`}
                          >
                            {m.excluded
                              ? t('eventForm.meals.include')
                              : t('eventForm.meals.exclude')}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Step 5 · Settings ── */}
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
                  setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
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

      {/* ── Step 6 · Preview ── */}
      {step === 5 && (
        <section className="section-card space-y-5">
          <StepHeading>{t('eventForm.steps.preview')}</StepHeading>
          <p className="text-sm text-neutral-500">{t('eventForm.preview.intro')}</p>

          <PreviewBlock title={t('eventForm.preview.basic')}>
            <PreviewRow
              label={t('eventForm.fields.center')}
              value={
                sortedCenters.find((c) => c.id === centerId)
                  ? locale === 'cs'
                    ? sortedCenters.find((c) => c.id === centerId)!.name_cs
                    : sortedCenters.find((c) => c.id === centerId)!.name_en
                  : ''
              }
            />
            <PreviewRow label={t('eventForm.fields.title_cs')} value={values.title_cs} />
            <PreviewRow label={t('eventForm.fields.title_en')} value={values.title_en} />
            <PreviewRow label={t('eventForm.fields.description_cs')} value={values.subtitle_cs} />
            <PreviewRow label={t('eventForm.fields.description_en')} value={values.subtitle_en} />
            <PreviewRow label={t('eventForm.fields.contactName')} value={values.contactName} />
            <PreviewRow label={t('eventForm.fields.contactPhone')} value={values.contactPhone} />
            <PreviewRow label={t('eventForm.fields.contactEmail')} value={values.contactEmail} />
          </PreviewBlock>

          <PreviewBlock title={t('eventForm.preview.schedule')}>
            <PreviewRow label={t('eventForm.fields.startDate')} value={values.startDate} />
            <PreviewRow label={t('eventForm.fields.endDate')} value={values.endDate} />
            {days.length > 0 && (
              <PreviewRow
                label={t('eventForm.schedule.eventDays')}
                value={days
                  .map((d) => (locale === 'cs' ? d.label_cs : d.label_en))
                  .join(' · ')}
              />
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
            {days.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('eventForm.preview.noMeals')}</p>
            ) : (
              days.map((d) => (
                <PreviewRow
                  key={d.date}
                  label={locale === 'cs' ? d.label_cs : d.label_en}
                  value={MEAL_TYPES.map((meal) => {
                    const m = getMeal(d.date, meal)
                    return m.excluded
                      ? `${t(`mealType.${meal}`)} —`
                      : `${t(`mealType.${meal}`)} ${m.price}`
                  }).join(' · ')}
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

      {/* ── Step 7 · Save ── */}
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
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => attemptSave(false)}
              className="btn-secondary"
            >
              {t('eventForm.save')}
            </button>
            <button
              type="button"
              onClick={() => attemptSave(true)}
              className="btn-primary"
            >
              {t('eventForm.saveAndPublish')}
            </button>
          </div>
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

      {/* Publish confirmation (status PUBLISHED or "Save and Publish") */}
      {publishModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-sm"
          onClick={() => setPublishModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif text-xl font-semibold text-neutral-900">
              {t('eventForm.publishConfirmTitle')}
            </h2>
            <div className="mt-2 mb-4 h-0.5 w-10 rounded bg-primary-500" />
            <p className="text-sm text-neutral-600">{t('eventForm.publishConfirmBody')}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPublishModal(false)}
                className="btn-secondary"
              >
                {t('eventForm.publishCancel')}
              </button>
              <button type="button" onClick={confirmPublish} className="btn-primary">
                {t('eventForm.publishConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
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
  children,
}: {
  label: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div>
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
