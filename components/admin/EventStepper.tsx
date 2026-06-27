'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale, useTranslations } from 'next-intl'
import { eventCreateSchema, type EventCreateInput } from '@/lib/validation'
import type {
  EventDateDTO,
  EventMealDTO,
  PricingRuleDTO,
} from '@/modules/events'
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

// Scalar fields covered by eventCreateSchema. centerId + description_* are now
// real schema fields (B7c). Pricing and meals stay UI-only state (assembled into
// the POST payload on save); event days are derived from the date range.
type EventFormValues = {
  centerId: string
  title_cs: string
  title_en: string
  description_cs: string
  description_en: string
  contactName: string
  contactPhone: string
  contactEmail: string
  startDate: string
  endDate: string
  maxRegistrations?: number
  // Europe/Prague wall-clock "YYYY-MM-DDTHH:mm" (datetime-local). Empty → no
  // deadline. Converted to a UTC instant in the service.
  mealRegistrationDeadline?: string
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED'
}

export type EventStepperInitial = Partial<EventFormValues>

// Read-only relation data shown in edit mode (centre/dates/pricing/meals are
// immutable after creation — §0 decision 1). Only present when mode="edit".
export type EventStepperEditData = {
  id: string
  dates: EventDateDTO[]
  meals: EventMealDTO[]
  pricingRules: PricingRuleDTO[]
}

type CenterOption = { id: string; name_cs: string; name_en: string }

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

// Children carry only a daily + night rate (arrival/departure discounts are a
// 15+-only concept — mirrors the real BDC price list). Both default to 0 but are
// admin-editable so the engine charges exactly what the price list says.
type PricingChild = { dailyRate: number; nightRate: number }
const CHILD_FIELDS: (keyof PricingChild)[] = ['dailyRate', 'nightRate']

const FIELD_STEP: Record<keyof EventFormValues, number> = {
  centerId: 0,
  title_cs: 0,
  title_en: 0,
  description_cs: 0,
  description_en: 0,
  contactName: 0,
  contactPhone: 0,
  contactEmail: 0,
  startDate: 1,
  endDate: 1,
  maxRegistrations: 4,
  mealRegistrationDeadline: 4,
  status: 4,
}

// Default catalogue 15+ prices — prefill only, editable per event. Mirrors the
// sample values shown in the public "Informace o cenách" (and the seed event),
// same pattern as DEFAULT_MEAL_PRICE for meals. Real engine defaults are P5.
// Arrival discounts MUST be monotonic (morning ≤ afternoon ≤ evening): the later
// you arrive, the more of the day you miss, so the larger the discount. A
// non-monotonic set makes a later arrival cost MORE — illogical (engine subtracts
// each discount in modules/pricing).
const DEFAULT_PRICING_15: Record<MockPricingType, Pricing15> = {
  STANDARD: {
    dailyRate: 200,
    nightRate: 150,
    morningArrivalDiscount: 30,
    afternoonArrivalDiscount: 50,
    eveningArrivalDiscount: 80,
    earlyDepartureDiscount: 50,
  },
  SUPPORTED: {
    dailyRate: 100,
    nightRate: 100,
    morningArrivalDiscount: 20,
    afternoonArrivalDiscount: 30,
    eveningArrivalDiscount: 50,
    earlyDepartureDiscount: 30,
  },
  SURPLUS: {
    dailyRate: 300,
    nightRate: 200,
    morningArrivalDiscount: 30,
    afternoonArrivalDiscount: 50,
    eveningArrivalDiscount: 80,
    earlyDepartureDiscount: 50,
  },
}

const mealKey = (date: string, meal: MealType) => `${date}|${meal}`

// Shift an ISO yyyy-mm-dd by n days (UTC), for the meal-deadline min bound.
function isoMinusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// ── Prefill the editable pricing/meal state from a stored event (draft edit) ──
// A draft with no registrations is fully editable (§0 decision 1 revised): the
// 15+/child rates and per-day meals start from the event's saved values instead
// of the catalogue defaults, so the admin tweaks rather than re-enters them.
function initialPricing15(
  editData?: EventStepperEditData,
): Record<MockPricingType, Pricing15> {
  const base: Record<MockPricingType, Pricing15> = {
    STANDARD: { ...DEFAULT_PRICING_15.STANDARD },
    SUPPORTED: { ...DEFAULT_PRICING_15.SUPPORTED },
    SURPLUS: { ...DEFAULT_PRICING_15.SURPLUS },
  }
  for (const r of editData?.pricingRules ?? []) {
    if (r.ageCategory === 'AGE_15_PLUS' && (PRICING_TYPES as string[]).includes(r.pricingType)) {
      base[r.pricingType as MockPricingType] = {
        dailyRate: r.dailyRate,
        nightRate: r.nightRate,
        morningArrivalDiscount: r.morningArrivalDiscount,
        afternoonArrivalDiscount: r.afternoonArrivalDiscount,
        eveningArrivalDiscount: r.eveningArrivalDiscount,
        earlyDepartureDiscount: r.earlyDepartureDiscount,
      }
    }
  }
  return base
}

function initialPricingChild(
  editData?: EventStepperEditData,
): Record<string, PricingChild> {
  const base: Record<string, PricingChild> = {
    AGE_0_3: { dailyRate: 0, nightRate: 0 },
    AGE_4_7: { dailyRate: 0, nightRate: 0 },
    AGE_8_14: { dailyRate: 0, nightRate: 0 },
  }
  for (const r of editData?.pricingRules ?? []) {
    if ((CHILD_AGES as string[]).includes(r.ageCategory)) {
      base[r.ageCategory] = { dailyRate: r.dailyRate, nightRate: r.nightRate }
    }
  }
  return base
}

function initialMealEdits(editData?: EventStepperEditData): Record<string, MealEdit> {
  const out: Record<string, MealEdit> = {}
  if (!editData) return out
  const isoByDateId = new Map(editData.dates.map((d) => [d.id, d.date]))
  for (const m of editData.meals) {
    const date = isoByDateId.get(m.eventDateId)
    if (!date) continue
    out[mealKey(date, m.mealType as MealType)] = { price: m.price, excluded: m.isClosed }
  }
  return out
}

export default function EventStepper({
  centers,
  mode = 'create',
  initial,
  editData,
  canEditRelations = false,
  initialStep = 0,
}: {
  centers: CenterOption[]
  mode?: 'create' | 'edit'
  initial?: EventStepperInitial
  editData?: EventStepperEditData
  // A draft event with no registrations is fully editable: centre, dates,
  // pricing and meals (not just scalars). Create mode is always fully editable.
  canEditRelations?: boolean
  // The step to open on (read from ?step= by the server page) so switching
  // language keeps the current step instead of jumping back to step 1.
  initialStep?: number
}) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const router = useRouter()
  const isEdit = mode === 'edit'
  // Centre/dates/pricing/meals are immutable only when editing a published event
  // (or a draft that already has registrations) — see canEditRelations.
  const relationsLocked = isEdit && !canEditRelations

  const [step, setStep] = useState(() =>
    Math.min(Math.max(0, initialStep), STEP_KEYS.length - 1),
  )
  const [publishModal, setPublishModal] = useState(false)
  const [successKind, setSuccessKind] = useState<'published' | 'saved' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Keep the active step in the URL (?step=) without a navigation, so the
  // language switcher (which re-navigates and remounts this island) can restore
  // it from the query instead of resetting to step 1.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if (step === 0) sp.delete('step')
    else sp.set('step', String(step))
    const qs = sp.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }, [step])

  // UI-only state (assembled into the payload on save). For a fully-editable
  // draft these prefill from the saved event; otherwise they're catalogue
  // defaults (create) and unused (locked edit renders read-only from editData).
  const [pricing15, setPricing15] = useState<Record<MockPricingType, Pricing15>>(
    () => initialPricing15(editData),
  )
  const [pricingChild, setPricingChild] = useState<Record<string, PricingChild>>(
    () => initialPricingChild(editData),
  )
  const [mealEdits, setMealEdits] = useState<Record<string, MealEdit>>(() =>
    initialMealEdits(editData),
  )

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<EventFormValues, unknown, EventCreateInput>({
    resolver: zodResolver(eventCreateSchema) as unknown as Resolver<
      EventFormValues,
      unknown,
      EventCreateInput
    >,
    defaultValues: {
      centerId: initial?.centerId ?? '',
      title_cs: initial?.title_cs ?? '',
      title_en: initial?.title_en ?? '',
      description_cs: initial?.description_cs ?? '',
      description_en: initial?.description_en ?? '',
      contactName: initial?.contactName ?? '',
      contactPhone: initial?.contactPhone ?? '',
      contactEmail: initial?.contactEmail ?? '',
      startDate: initial?.startDate ?? '',
      endDate: initial?.endDate ?? '',
      maxRegistrations: initial?.maxRegistrations,
      mealRegistrationDeadline: initial?.mealRegistrationDeadline ?? '',
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

  // Keep the server's sortOrder (same as the public form's centre dropdown):
  // alphabetical with the special entries "Jiné" / "Mimo ČR" pinned last.
  const sortedCenters = centers

  // Start date cannot be in the past (not expressible in the schema, so enforced
  // here + via the input's min). Only applies when the dates are editable; a
  // locked edit shows them read-only and an existing event may already have started.
  const startInPast = !relationsLocked && startDate !== '' && startDate < todayISO()

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
  const updatePricingChild = (age: string, patch: Partial<PricingChild>) =>
    setPricingChild((prev) => ({ ...prev, [age]: { ...prev[age]!, ...patch } }))

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
    if (name === 'mealRegistrationDeadline') return t('eventForm.errors.mealDeadline')
    return t('eventForm.errors.required')
  }

  // Assemble the full create payload: validated scalars + derived dates + the
  // 15+ pricing rows + the per-age child rows (admin-set daily/night) + meals.
  function buildPayload(data: EventCreateInput) {
    return {
      ...data,
      dates: days.map((d, i) => ({
        date: d.date,
        label_cs: d.label_cs,
        label_en: d.label_en,
        sortOrder: i + 1,
      })),
      pricingRules: [
        ...CHILD_AGES.map((age) => ({
          ageCategory: age,
          pricingType: 'STANDARD' as const,
          dailyRate: pricingChild[age]?.dailyRate ?? 0,
          nightRate: pricingChild[age]?.nightRate ?? 0,
          // Discounts are 15+-only (mirrors the BDC price list) — children: 0.
          morningArrivalDiscount: 0,
          afternoonArrivalDiscount: 0,
          eveningArrivalDiscount: 0,
          earlyDepartureDiscount: 0,
        })),
        ...PRICING_TYPES.map((type) => ({
          ageCategory: 'AGE_15_PLUS' as const,
          pricingType: type,
          ...pricing15[type],
        })),
      ],
      meals: days.flatMap((d) =>
        MEAL_TYPES.map((meal) => {
          const m = getMeal(d.date, meal)
          return { date: d.date, mealType: meal, price: m.price, isClosed: m.excluded }
        }),
      ),
    }
  }

  const onValid = async (data: EventCreateInput) => {
    setSubmitError(null)
    setSubmitting(true)
    try {
      // An empty deadline on EDIT means "clear it" (the server distinguishes ''
      // = clear from an absent key = leave unchanged), so the new "clear
      // deadline" button can remove an already-set cut-off.
      const deadline = data.mealRegistrationDeadline ?? ''
      // Body shape:
      //  • create → full assembled payload (POST).
      //  • edit, fully-editable draft → full payload too (centre/dates/pricing/
      //    meals are replaceable while no registration depends on them).
      //  • edit, locked → only the editable scalars (§0 decision 1).
      const url = isEdit ? `/api/admin/events/${editData?.id}` : '/api/admin/events'
      let body: string
      if (!isEdit) {
        body = JSON.stringify(buildPayload(data))
      } else if (canEditRelations) {
        body = JSON.stringify({ ...buildPayload(data), mealRegistrationDeadline: deadline })
      } else {
        body = JSON.stringify({
          title_cs: data.title_cs,
          title_en: data.title_en,
          description_cs: data.description_cs ?? '',
          description_en: data.description_en ?? '',
          contactName: data.contactName ?? '',
          contactPhone: data.contactPhone ?? '',
          contactEmail: data.contactEmail,
          maxRegistrations: data.maxRegistrations,
          mealRegistrationDeadline: deadline,
          status: data.status,
        })
      }
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (isEdit ? res.ok : res.status === 201) {
        // Confirm what happened (published vs. saved) instead of silently
        // bouncing to the list — the admin gets feedback first.
        setSuccessKind(data.status === 'PUBLISHED' ? 'published' : 'saved')
        return
      }
      if (res.status === 403) {
        setSubmitError(t('eventForm.errors.forbidden'))
        setStep(0)
      } else if (res.status === 422) {
        setSubmitError(t('eventForm.validationError'))
      } else {
        setSubmitError(t('eventForm.errors.submitFailed'))
      }
    } catch {
      setSubmitError(t('eventForm.errors.submitFailed'))
    } finally {
      setSubmitting(false)
    }
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
    // The start-date-in-the-past guard applies whenever the dates are editable
    // (create or a fully-editable draft); a locked event may already have started.
    if (!relationsLocked && getValues('startDate') && getValues('startDate') < todayISO()) {
      setStep(1)
      return
    }
    const willPublish = forcePublish || getValues('status') === 'PUBLISHED'
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

  function goToList() {
    router.push(`/${locale}/admin/events`)
    router.refresh()
  }

  // "Next" advances a step — but leaving the Schedule step (index 1) first
  // validates the date range so an invalid term (end before start, missing, or a
  // past start) is caught here, not only at the final save. The schema's
  // end-after-start refinement runs via trigger(); the past-start guard is local.
  async function handleNext() {
    if (step === 1 && !relationsLocked) {
      const datesOk = await trigger(['startDate', 'endDate'])
      if (!datesOk || startInPast) return
    }
    setStep((s) => Math.min(STEP_KEYS.length - 1, s + 1))
  }

  const values = watch()
  const selectedCenter = sortedCenters.find((c) => c.id === values.centerId)

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

          <TextField label={t('eventForm.fields.center')} error={fieldError('centerId')}>
            {relationsLocked ? (
              // Centre is immutable once a registration depends on it — show it
              // read-only, but keep the value registered so validation passes.
              <>
                <input type="hidden" {...register('centerId')} />
                <div className="bdc-input bg-neutral-50 text-neutral-600">
                  {selectedCenter
                    ? locale === 'cs'
                      ? selectedCenter.name_cs
                      : selectedCenter.name_en
                    : '—'}
                </div>
              </>
            ) : (
              <select className="bdc-input" {...register('centerId')}>
                <option value="">—</option>
                {sortedCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {locale === 'cs' ? c.name_cs : c.name_en}
                  </option>
                ))}
              </select>
            )}
          </TextField>

          <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            <TextField label={t('eventForm.fields.title_cs')} error={fieldError('title_cs')}>
              <input className="bdc-input" {...register('title_cs')} />
            </TextField>
            <TextField label={t('eventForm.fields.title_en')} error={fieldError('title_en')}>
              <input className="bdc-input" {...register('title_en')} />
            </TextField>
            <TextField label={t('eventForm.fields.description_cs')}>
              <textarea rows={2} className="bdc-input" {...register('description_cs')} />
            </TextField>
            <TextField label={t('eventForm.fields.description_en')}>
              <textarea rows={2} className="bdc-input" {...register('description_en')} />
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
                readOnly={relationsLocked}
                className={`bdc-input ${relationsLocked ? 'bg-neutral-50 text-neutral-600' : ''}`}
                {...register('startDate')}
              />
            </TextField>
            <TextField label={t('eventForm.fields.endDate')} error={fieldError('endDate')}>
              <input
                type="date"
                min={startDate || todayISO()}
                readOnly={relationsLocked}
                className={`bdc-input ${relationsLocked ? 'bg-neutral-50 text-neutral-600' : ''}`}
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

      {/* ── Step 3 · Pricing (UI state; engine + defaults in P5) ── */}
      {step === 2 && (
        <section className="section-card space-y-6">
          <StepHeading>{t('eventForm.steps.pricing')}</StepHeading>
          <p className="text-sm text-neutral-500">
            {relationsLocked ? t('eventForm.editLockedNote') : t('eventForm.pricing.intro')}
          </p>

          {/* Children (0–14): admin-editable daily + night rate (default 0). The
              engine charges exactly what's entered (no age is hard-coded to 0). */}
          <div className="space-y-4">
            {CHILD_AGES.map((age) => {
              const stored = (editData?.pricingRules ?? []).find(
                (r) => r.ageCategory === age,
              )
              return (
                <div
                  key={age}
                  className="rounded-xl border border-neutral-200 bg-stone-50 p-4"
                >
                  <p className="mb-3 text-sm font-semibold text-primary-700">
                    {t(`age.${age}`)}
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {CHILD_FIELDS.map((f) =>
                      relationsLocked ? (
                        <PreviewRow
                          key={f}
                          label={t(`eventForm.fields.${f}`)}
                          value={String(stored?.[f] ?? 0)}
                        />
                      ) : (
                        <TextField key={f} label={t(`eventForm.fields.${f}`)}>
                          <input
                            type="number"
                            min={0}
                            className="bdc-input"
                            value={pricingChild[age]![f]}
                            onChange={(e) =>
                              updatePricingChild(age, { [f]: Number(e.target.value) || 0 })
                            }
                          />
                        </TextField>
                      ),
                    )}
                  </div>
                </div>
              )
            })}
            <p className="text-xs text-neutral-500">
              {t('eventForm.pricing.childNote')}
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-neutral-900">
              {t('age.AGE_15_PLUS')}
            </h3>
            {relationsLocked
              ? // Read-only: the stored 15+ pricing rules (immutable after creation).
                (editData?.pricingRules ?? [])
                  .filter((r) => r.ageCategory === 'AGE_15_PLUS')
                  .map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl border border-neutral-200 bg-stone-50 p-4"
                    >
                      <p className="mb-3 text-sm font-semibold text-primary-700">
                        {t(`pricingType.${r.pricingType}`)}
                      </p>
                      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                        {PRICING15_FIELDS.map((f) => (
                          <PreviewRow
                            key={f}
                            label={t(`eventForm.fields.${f}`)}
                            value={String(r[f])}
                          />
                        ))}
                      </div>
                    </div>
                  ))
              : PRICING_TYPES.map((type) => (
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
          <p className="text-sm text-neutral-500">
            {relationsLocked ? t('eventForm.editLockedNote') : t('eventForm.meals.intro')}
          </p>

          {relationsLocked ? (
            // Read-only: the stored per-day meals (immutable after creation —
            // existing ParticipantMeal rows reference these EventMeal ids).
            <div className="space-y-4">
              {(editData?.dates ?? []).map((d) => {
                const dayMeals = (editData?.meals ?? []).filter(
                  (m) => m.eventDateId === d.id,
                )
                return (
                  <div
                    key={d.id}
                    className="rounded-xl border border-neutral-200 bg-stone-50 p-4"
                  >
                    <p className="text-sm font-semibold text-neutral-900">
                      {t('eventForm.meals.forDate')}:{' '}
                      {locale === 'cs' ? d.label_cs : d.label_en}
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      {dayMeals.map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-lg border border-neutral-200 bg-white p-3 ${
                            m.isClosed ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-neutral-800">
                              {t(`mealType.${m.mealType}`)}
                            </span>
                            {m.isClosed && (
                              <span className="badge bg-neutral-200 text-neutral-600 border border-neutral-300">
                                {t('eventForm.meals.excluded')}
                              </span>
                            )}
                          </div>
                          <p className="price-amount mt-2">
                            {m.isClosed ? '—' : m.price}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : days.length === 0 ? (
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

          {/* Meal-ordering deadline (optional). Prague wall-clock; min = a week
              before the start, max = the end day (the engine stores UTC). */}
          <TextField
            label={t('eventForm.fields.mealRegistrationDeadline')}
            error={fieldError('mealRegistrationDeadline')}
          >
            <input
              type="datetime-local"
              className="bdc-input"
              min={startDate ? `${isoMinusDays(startDate, 7)}T00:00` : undefined}
              max={endDate ? `${endDate}T23:59` : undefined}
              {...register('mealRegistrationDeadline', {
                setValueAs: (v) => (v === '' || v == null ? undefined : v),
              })}
            />
            {watch('mealRegistrationDeadline') ? (
              <button
                type="button"
                onClick={() =>
                  setValue('mealRegistrationDeadline', '', { shouldValidate: false })
                }
                className="mt-2 text-sm font-medium text-danger-600 hover:text-danger-700"
              >
                {t('eventForm.settings.clearDeadline')}
              </button>
            ) : null}
            <p className="mt-1 text-xs text-neutral-500">
              {t('eventForm.settings.mealDeadlineNote')}
            </p>
          </TextField>
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
              value={selectedCenter ? (locale === 'cs' ? selectedCenter.name_cs : selectedCenter.name_en) : ''}
            />
            <PreviewRow label={t('eventForm.fields.title_cs')} value={values.title_cs} />
            <PreviewRow label={t('eventForm.fields.title_en')} value={values.title_en} />
            <PreviewRow label={t('eventForm.fields.description_cs')} value={values.description_cs} />
            <PreviewRow label={t('eventForm.fields.description_en')} value={values.description_en} />
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
            <PreviewRow
              label={t('eventForm.fields.mealRegistrationDeadline')}
              value={
                values.mealRegistrationDeadline
                  ? values.mealRegistrationDeadline.replace('T', ' ')
                  : t('eventForm.settings.noDeadline')
              }
            />
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
          {submitError && (
            <div className="rounded-lg border border-danger-500/40 bg-danger-50 p-4">
              <p className="text-sm font-semibold text-danger-700">{submitError}</p>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => attemptSave(false)}
              disabled={submitting}
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('eventForm.save')}
            </button>
            <button
              type="button"
              onClick={() => attemptSave(true)}
              disabled={submitting}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
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
          <button type="button" onClick={() => void handleNext()} className="btn-primary">
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

      {/* Post-save confirmation — what happened (published vs. saved), then on to
          the list. Replaces the old silent redirect (task: show feedback first). */}
      {successKind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="font-serif text-xl font-semibold text-neutral-900">
              {t(`eventForm.success.${successKind}Title`)}
            </h2>
            <div className="mt-2 mb-4 h-0.5 w-10 rounded bg-primary-500" />
            <p className="text-sm text-neutral-600">
              {t(`eventForm.success.${successKind}Body`)}
            </p>
            <div className="mt-6 flex justify-end">
              <button type="button" onClick={goToList} className="btn-primary">
                {t('eventForm.success.toList')}
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
