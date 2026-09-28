'use client'

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { RegStatusBadge } from '@/components/admin/StatusBadge'
import { getAvailableMealIds, type ArrivalTime, type EarlyDeparture } from '@/lib/utils/mealAvailability'
import { resolveMealPrice } from '@/lib/utils/mealPrice'
import { checkStayOrder } from '@/lib/utils/stayRules'
import { useDebounce } from '@/lib/utils/useDebounce'
import { registrationFullUpdateSchema } from '@/lib/validation'
import type { EventDateDTO, EventMealDTO, MealPricingRuleDTO } from '@/lib/types'
import type { AdminRegistrationStatus } from '@/modules/registrations'

// The admin FULL edit of one registration (M50b) — the registration team's on-site
// tool: a family registered and one of them did not come, someone leaves a day
// early, a child was booked as an adult. Everything the registrant chose is shown
// exactly as stored and can be changed; people can be added and removed. The
// price is recalculated live by the SERVER (POST …/calculate-price) and the save
// (PUT …/full) re-prices again before writing — this island sends choices, never
// amounts (invariants 3–4). Its decisions (Martin, 2026-09-28): meals stay
// editable after the meal deadline, with a notice; a closed meal is never offered;
// the last person cannot be removed; a PAID registration whose price changes drops
// back to REGISTERED until the team collects the difference; the e-mail is not
// editable; nothing is mailed on save.

const REG_STATUSES: AdminRegistrationStatus[] = ['REGISTERED', 'PAID', 'CANCELLED']
const TIERS = ['STANDARD', 'SUPPORTED', 'SURPLUS'] as const
const AGES = ['AGE_0_3', 'AGE_4_7', 'AGE_8_14', 'AGE_15_PLUS'] as const
const DIETS = ['MEAT', 'VEGETARIAN'] as const
const ARRIVAL_TIMES = ['MORNING', 'AFTERNOON', 'EVENING'] as const
const EARLY = ['NONE', 'AFTER_BREAKFAST'] as const
const MEAL_ORDER: Record<string, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 }
const MAX_PARTICIPANTS = 10
const PREVIEW_DEBOUNCE_MS = 500

type Tier = (typeof TIERS)[number]
type Age = (typeof AGES)[number]
type Diet = (typeof DIETS)[number]

export type FullEditorParticipant = {
  id: string
  fullName: string
  ageCategory: Age
  pricingType: Tier
  mealPricingType: Tier
  mealType: Diet
  mealIds: string[]
  totalPrice: number
}

export type FullEditorData = {
  registrationId: string
  registrationNumber: string
  // The row's updatedAt when the page was rendered — the token the save is
  // guarded by. The editor body is keyed on it, so every successful save (and
  // every resend, which also moves it) remounts the body with fresh ids and a
  // fresh token instead of saving new people twice.
  updatedAt: string
  centerId: string
  status: AdminRegistrationStatus
  totalPrice: number
  hasAccommodation: boolean
  arrivalDateId: string
  arrivalTime: ArrivalTime
  departureDateId: string
  earlyDeparture: EarlyDeparture
  participants: FullEditorParticipant[]
  event: {
    dates: EventDateDTO[]
    meals: EventMealDTO[]
    mealPricingRules: MealPricingRuleDTO[]
    participationPricingTypes: string[]
    mealPricingTypes: string[]
    mealDeadline: string | null
  }
}

type DraftParticipant = Omit<FullEditorParticipant, 'id' | 'totalPrice'> & {
  key: string // stable React key: the row id, or a local one for a person being added
  id?: string
}

type Draft = {
  status: AdminRegistrationStatus
  hasAccommodation: boolean
  arrivalDateId: string
  arrivalTime: ArrivalTime
  departureDateId: string
  earlyDeparture: EarlyDeparture
  participants: DraftParticipant[]
}

type Preview = { key: string; totalPrice: number; subtotals: number[] }

// ─── Tier helpers (same readings as the public form and the price overview) ───

// An EMPTY set means all three — the reading every other surface uses.
function offeredTiers(set: string[]): readonly Tier[] {
  const offered = TIERS.filter((t) => set.includes(t))
  return offered.length > 0 ? offered : TIERS
}
// The offered tiers, plus the one this person is stranded on if the event no
// longer offers it — a <select> whose value matches no option would SHOW another.
function optionsFor(offered: readonly Tier[], current: Tier): readonly Tier[] {
  return offered.includes(current) ? offered : [current, ...offered]
}
// A select only where there is a choice, or where the stored tier must be seen.
function showTier(offered: readonly Tier[], current: Tier): boolean {
  return offered.length > 1 || !offered.includes(current)
}

function draftFrom(data: FullEditorData): Draft {
  return {
    status: data.status,
    hasAccommodation: data.hasAccommodation,
    arrivalDateId: data.arrivalDateId,
    arrivalTime: data.arrivalTime,
    departureDateId: data.departureDateId,
    earlyDeparture: data.earlyDeparture,
    participants: data.participants.map((p) => ({
      key: p.id,
      id: p.id,
      fullName: p.fullName,
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealPricingType: p.mealPricingType,
      mealType: p.mealType,
      // Sorted, here and on every toggle: the order meals were ticked in is not a
      // change, and must not read as one (unsaved-changes, a price request).
      mealIds: [...p.mealIds].sort(),
    })),
  }
}

// Only what moves money — names, diet and status do not, so typing a name never
// costs a request against the shared admin rate limit (120/min per IP). The ids
// ride along: the server keeps a stranded tier only for the person who holds it.
// The key IS the preview's request body, parsed back — see previewBody.
type PriceState = Pick<Draft, 'hasAccommodation' | 'arrivalDateId' | 'arrivalTime' | 'departureDateId' | 'earlyDeparture'> & {
  participants: Pick<DraftParticipant, 'id' | 'ageCategory' | 'pricingType' | 'mealPricingType' | 'mealIds'>[]
}
function priceKeyOf(d: Draft): string {
  const state: PriceState = {
    hasAccommodation: d.hasAccommodation,
    arrivalDateId: d.arrivalDateId,
    arrivalTime: d.arrivalTime,
    departureDateId: d.departureDateId,
    earlyDeparture: d.earlyDeparture,
    participants: d.participants.map((p) => ({
      id: p.id,
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealPricingType: p.mealPricingType,
      mealIds: p.mealIds,
    })),
  }
  return JSON.stringify(state)
}

// The preview request for one price key. Name, diet and status are not priced, so
// fixed placeholders stand in for them — which is what lets the key leave them out.
function previewBody(key: string, centerId: string) {
  const s = JSON.parse(key) as PriceState
  return {
    ...s,
    status: 'REGISTERED',
    centerId,
    participants: s.participants.map((p) => ({ ...p, fullName: '--', mealType: 'MEAT' })),
  }
}

function participantsPayload(d: Draft) {
  return d.participants.map((p) => ({
    ...(p.id ? { id: p.id } : {}),
    fullName: p.fullName,
    ageCategory: p.ageCategory,
    pricingType: p.pricingType,
    mealPricingType: p.mealPricingType,
    mealType: p.mealType,
    mealIds: p.mealIds,
  }))
}

// ─── Outer shell: owns only the toast, so it survives the body's remount ──────

export default function RegistrationFullEditor({
  data,
  numberLabel,
  pricingButton,
  children,
}: {
  data: FullEditorData
  numberLabel: string
  pricingButton: ReactNode
  children: ReactNode
}) {
  const [toast, setToast] = useState<string | null>(null)
  return (
    <EditorBody
      key={data.updatedAt}
      data={data}
      numberLabel={numberLabel}
      pricingButton={pricingButton}
      toast={toast}
      setToast={setToast}
    >
      {children}
    </EditorBody>
  )
}

function EditorBody({
  data,
  numberLabel,
  pricingButton,
  toast,
  setToast,
  children,
}: {
  data: FullEditorData
  numberLabel: string
  pricingButton: ReactNode
  toast: string | null
  setToast: (value: string | null) => void
  children: ReactNode
}) {
  const t = useTranslations('admin')
  const locale = useLocale()
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const ev = data.event

  const initialDraft = useMemo(() => draftFrom(data), [data])
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [error, setError] = useState<{ message: string; reload?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  // D4 — the admin's explicit status pick wins over the automatic one, but only
  // for the price it was made against: a PAID picked at one price is not a PAID
  // for a price changed afterwards. Holds the price key current at the pick.
  const [statusPickedAt, setStatusPickedAt] = useState<string | null>(null)
  const newKey = useRef(0)
  // Read once: whether the meal cut-off has passed decides a notice, not access.
  const [deadlinePassed] = useState(
    () => ev.mealDeadline !== null && Date.now() >= Date.parse(ev.mealDeadline),
  )

  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft)
  const working = busy || refreshing

  const participationTiers = offeredTiers(ev.participationPricingTypes)
  const mealTiers = offeredTiers(ev.mealPricingTypes)
  const sortedDates = useMemo(() => [...ev.dates].sort((a, b) => a.sortOrder - b.sortOrder), [ev.dates])
  const orderById = useMemo(() => new Map(ev.dates.map((d) => [d.id, d.sortOrder])), [ev.dates])
  const mealById = useMemo(() => new Map(ev.meals.map((m) => [m.id, m])), [ev.meals])
  const dayLabel = (d: { label_cs: string; label_en: string }) => (locale === 'cs' ? d.label_cs : d.label_en)

  // ─── The stay ───
  const stayViolation = stayViolationOf(draft, orderById)
  // A pill is disabled when picking it would break a stay rule — the SAME shared
  // rules the server applies. Arrival DAYS are the exception, never disabled: the
  // admin may be about to move the departure too; an impossible pair is explained
  // below the pills and blocks the save until fixed.
  const breaks = (patch: Partial<Pick<Draft, 'arrivalTime' | 'departureDateId' | 'earlyDeparture'>>) =>
    stayViolationOf({ ...draft, ...patch }, orderById) !== null
  const presentFor = useMemo(
    () =>
      getAvailableMealIds(
        {
          arrivalDateId: draft.arrivalDateId,
          arrivalTime: draft.arrivalTime,
          departureDateId: draft.departureDateId,
          earlyDeparture: draft.earlyDeparture,
        },
        ev.dates,
        ev.meals,
      ),
    [draft.arrivalDateId, draft.arrivalTime, draft.departureDateId, draft.earlyDeparture, ev.dates, ev.meals],
  )
  // A ticked meal this person cannot have: outside their stay, or one the event
  // does not serve. Only the 24 seeded demo registrations store such meals today;
  // they are shown ticked and flagged — never hidden — so the admin sees why the
  // price drops when they untick them, and the server refuses to save them.
  const isFlagged = (mealId: string) => !presentFor.has(mealId) || (mealById.get(mealId)?.isClosed ?? true)
  const anyFlagged = draft.participants.some((p) => p.mealIds.some(isFlagged))

  const clearFeedback = () => {
    setToast(null)
    setError(null)
  }

  // A stay change the admin makes drops the meals it takes the person away from,
  // exactly like the public form — in the same update, so the preview never sees
  // a stay and a meal set that contradict each other. An invalid combination
  // drops nothing: it is flagged, and the admin is still choosing.
  function changeStay(patch: Partial<Pick<Draft, 'arrivalDateId' | 'arrivalTime' | 'departureDateId' | 'earlyDeparture'>>) {
    clearFeedback()
    setDraft((prev) => {
      const next = { ...prev, ...patch }
      const violation = checkStayOrder({
        arrivalSortOrder: orderById.get(next.arrivalDateId) ?? 0,
        departureSortOrder: orderById.get(next.departureDateId) ?? 0,
        arrivalTime: next.arrivalTime,
        earlyDeparture: next.earlyDeparture,
      })
      if (violation) return next
      const window = getAvailableMealIds(next, ev.dates, ev.meals)
      return {
        ...next,
        participants: next.participants.map((p) => ({ ...p, mealIds: p.mealIds.filter((id) => window.has(id)) })),
      }
    })
  }

  function changeDraft(patch: Partial<Draft>) {
    clearFeedback()
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  function changeParticipant(key: string, patch: Partial<DraftParticipant>) {
    clearFeedback()
    setDraft((prev) => ({
      ...prev,
      participants: prev.participants.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    }))
  }

  function toggleMeal(key: string, mealId: string) {
    const p = draft.participants.find((x) => x.key === key)
    if (!p) return
    changeParticipant(key, {
      mealIds: p.mealIds.includes(mealId) ? p.mealIds.filter((id) => id !== mealId) : [...p.mealIds, mealId].sort(),
    })
  }

  function addParticipant() {
    newKey.current += 1
    changeDraft({
      participants: [
        ...draft.participants,
        {
          key: `new-${newKey.current}`,
          fullName: '',
          ageCategory: 'AGE_15_PLUS',
          // STANDARD is every event's mandatory tier (invariant 22), so it is the
          // one default that is always offered.
          pricingType: 'STANDARD',
          mealPricingType: 'STANDARD',
          mealType: 'MEAT',
          mealIds: [],
        },
      ],
    })
  }

  function removeParticipant(key: string) {
    if (draft.participants.length <= 1) return
    changeDraft({ participants: draft.participants.filter((p) => p.key !== key) })
  }

  function discard() {
    clearFeedback()
    setDraft(initialDraft)
    setStatusPickedAt(null)
  }

  // ─── Live price (server-computed) ───
  const priceKey = priceKeyOf(draft)
  const initialPriceKey = useMemo(() => priceKeyOf(initialDraft), [initialDraft])
  const debouncedKey = useDebounce(priceKey, PREVIEW_DEBOUNCE_MS)
  const [preview, setPreview] = useState<Preview | null>(null)
  // The key whose request failed (a 429 from the shared admin limit, a dropped
  // connection) — and a nonce the "calculate again" button bumps to resend it.
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // Asked once on open as well: the stored total is what was charged THEN, and a
  // save re-prices with today's engine — the screen must show the number the save
  // will write (one live test registration stores 550 where the engine says 850).
  useEffect(() => {
    const body = previewBody(debouncedKey, data.centerId)
    // A state the server would refuse is not sent: the editor already shows why.
    if (stayViolationOf(body, orderById)) return
    const window = getAvailableMealIds(body, ev.dates, ev.meals)
    if (body.participants.some((p) => p.mealIds.some((id) => !window.has(id) || mealById.get(id)?.isClosed !== false))) return
    let stale = false
    fetch(`/api/admin/registrations/${data.registrationId}/calculate-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { data: { totalPrice: number; participants: { subtotal: number }[] } }) => {
        if (stale) return
        setPreview({
          key: debouncedKey,
          totalPrice: json.data.totalPrice,
          subtotals: json.data.participants.map((p) => p.subtotal),
        })
      })
      .catch(() => {
        if (!stale) setFailedKey(debouncedKey)
      })
    return () => {
      stale = true
    }
  }, [debouncedKey, retryNonce, data.registrationId, data.centerId, orderById, mealById, ev.dates, ev.meals])

  // What the price currently IS: the server's answer for exactly this state, else
  // unknown. Until it is known the stored figures are shown greyed, not as fact.
  const current: { totalPrice: number; subtotals: number[] } | null = preview?.key === priceKey ? preview : null
  const unchangedPrices = priceKey === initialPriceKey
  const previewFailed = failedKey === priceKey && current === null
  const priceBlocked = stayViolation !== null || anyFlagged
  const calculating = current === null && !priceBlocked && !previewFailed
  const shownTotal = current?.totalPrice ?? preview?.totalPrice ?? data.totalPrice
  const retryPrice = () => {
    setFailedKey(null)
    setRetryNonce((n) => n + 1)
  }

  // D4 — a PAID registration whose price changes is no longer paid in full, so it
  // reads as REGISTERED until the team collects the difference and picks PAID
  // themselves. Derived, not stored: it follows the price both ways (back to the
  // stored total → PAID again), and a name fix, which prices nothing, never
  // triggers it. A status the admin picks is theirs — for that price.
  const autoSwitched =
    data.status === 'PAID' &&
    statusPickedAt !== priceKey &&
    draft.status === 'PAID' &&
    current !== null &&
    current.totalPrice !== data.totalPrice
  const status: AdminRegistrationStatus = autoSwitched ? 'REGISTERED' : draft.status
  const cancelled = status === 'CANCELLED'

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    // Next's <Link> navigates client-side, so closing the tab is the only exit
    // beforeunload covers. Every in-app link (header, sidebar, the event link,
    // the language switch) is caught here, in the capture phase, before Next's
    // own click handler runs.
    const leaveMessage = t('registrationDetail.leaveWarning')
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.origin !== window.location.origin) return
      if (!window.confirm(leaveMessage)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, t])

  // ─── Save / resend ───
  const personName = (index: number | undefined) => {
    const p = index !== undefined ? draft.participants[index] : undefined
    if (!p) return t('registrationDetail.participantNumber', { number: (index ?? 0) + 1 })
    return p.fullName.trim() || t('registrationDetail.participantNumber', { number: index! + 1 })
  }

  function refusalMessage(
    json: { code?: string; participantIndex?: number; half?: 'stay' | 'meals' } | null,
    status: number,
  ) {
    const code = json?.code
    const named = ['meal_outside_stay', 'meal_closed', 'meal_unknown']
    if (code && named.includes(code)) {
      return t(`registrationDetail.saveRefused.${code}`, { name: personName(json?.participantIndex) })
    }
    if (code === 'tier_unavailable' && json?.participantIndex !== undefined) {
      const key = json.half === 'meals' ? 'tier_unavailable_meals' : 'tier_unavailable_stay'
      return t(`registrationDetail.saveRefused.${key}`, { name: personName(json.participantIndex) })
    }
    const plain = [
      'registration_changed', 'capacity_reached', 'stay_invalid', 'tier_unavailable', 'center_invalid',
      'participant_unknown', 'forbidden', 'not_found',
    ]
    if (code && plain.includes(code)) return t(`registrationDetail.saveRefused.${code}`)
    if (status === 400) return t('registrationDetail.saveRefused.validation')
    return t('registrationDetail.saveFailed')
  }

  async function handleSave() {
    clearFeedback()
    const body = {
      expectedUpdatedAt: data.updatedAt,
      status,
      centerId: data.centerId,
      hasAccommodation: draft.hasAccommodation,
      arrivalDateId: draft.arrivalDateId,
      arrivalTime: draft.arrivalTime,
      departureDateId: draft.departureDateId,
      earlyDeparture: draft.earlyDeparture,
      participants: participantsPayload(draft),
    }
    if (!registrationFullUpdateSchema.safeParse(body).success) {
      setError({ message: t('registrationDetail.saveRefused.validation') })
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/registrations/${data.registrationId}/full`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setToast(t('registrationDetail.saved'))
        // New ids for added people and a new updatedAt arrive with the refresh,
        // which remounts this body (it is keyed on updatedAt). Until then the
        // buttons stay disabled, so a second click cannot create anyone twice.
        startRefresh(() => router.refresh())
        return
      }
      const json = (await res.json().catch(() => null)) as
        | { code?: string; participantIndex?: number; half?: 'stay' | 'meals' }
        | null
      setError({ message: refusalMessage(json, res.status), reload: json?.code === 'registration_changed' })
    } catch {
      setError({ message: t('registrationDetail.saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  async function handleResend() {
    clearFeedback()
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/registrations/${data.registrationId}/resend-confirmation`, {
        method: 'POST',
      })
      const json = (await res.json().catch(() => null)) as
        | { data?: { confirmationSent?: boolean }; code?: string }
        | null
      if (res.ok && json?.data?.confirmationSent) {
        setToast(t('registrationDetail.resent'))
        startRefresh(() => router.refresh())
      } else if (res.ok) {
        setError({ message: t('registrationDetail.resendFailed') })
      } else if (json?.code === 'registration_cancelled') {
        setError({ message: t('registrationDetail.resendRefused.registration_cancelled') })
      } else {
        setError({ message: t('registrationDetail.saveFailed') })
      }
    } catch {
      setError({ message: t('registrationDetail.saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  // Also held while the new price is still being calculated: until it is known,
  // whether a PAID registration stays paid (D4) is not known either.
  const saveDisabled = working || !dirty || stayViolation !== null || anyFlagged || current === null

  return (
    <div className="space-y-6 pb-16 md:pb-0">
      {/* Number band: number + live status badge; pricing popup top-right. */}
      <div className="relative">
        <div className="mb-3 flex justify-end sm:absolute sm:right-0 sm:top-0 sm:mb-0">{pricingButton}</div>
        <div className="flex flex-col items-center text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{numberLabel}</p>
          <div className="relative mt-1 inline-flex flex-col items-center sm:flex-row">
            <p className="font-mono text-3xl font-semibold tabular-nums text-neutral-900">{data.registrationNumber}</p>
            <span className="mt-2 whitespace-nowrap sm:absolute sm:left-full sm:top-1/2 sm:mt-0 sm:ml-3 sm:-translate-y-1/2">
              <RegStatusBadge status={status} />
            </span>
          </div>
        </div>
      </div>

      {/* Read-only facts (server-rendered): e-mail, event, home centre */}
      {children}

      {/* ─── Stay ─── */}
      <section className="section-card">
        <SectionHeading>{t('registrationDetail.sectionStay')}</SectionHeading>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
          <Field label={t('registrationDetail.arrivalDate')}>
            <Pills
              name="arrivalDateId"
              options={sortedDates.map((d) => d.id)}
              value={draft.arrivalDateId}
              labelFor={(id) => dayLabel(ev.dates.find((d) => d.id === id)!)}
              onPick={(v) => changeStay({ arrivalDateId: v })}
            />
          </Field>
          <Field label={t('registrationDetail.arrivalTimeLabel')}>
            <Pills
              name="arrivalTime"
              options={ARRIVAL_TIMES}
              value={draft.arrivalTime}
              labelFor={(v) => t(`arrivalTime.${v}`)}
              isDisabled={(v) => breaks({ arrivalTime: v as ArrivalTime })}
              onPick={(v) => changeStay({ arrivalTime: v as ArrivalTime })}
            />
          </Field>
          <Field label={t('registrationDetail.departureDate')}>
            <Pills
              name="departureDateId"
              options={sortedDates.map((d) => d.id)}
              value={draft.departureDateId}
              labelFor={(id) => dayLabel(ev.dates.find((d) => d.id === id)!)}
              isDisabled={(id) => breaks({ departureDateId: id })}
              onPick={(v) => changeStay({ departureDateId: v })}
            />
          </Field>
          <Field label={t('registrationDetail.earlyDeparture')}>
            <Pills
              name="earlyDeparture"
              options={EARLY}
              value={draft.earlyDeparture}
              labelFor={(v) => (v === 'NONE' ? t('registrationDetail.earlyNone') : t('registrationDetail.afterBreakfast'))}
              isDisabled={(v) => breaks({ earlyDeparture: v as EarlyDeparture })}
              onPick={(v) => changeStay({ earlyDeparture: v as EarlyDeparture })}
            />
          </Field>
          <Field label={t('registrationDetail.accommodation')}>
            <Pills
              name="hasAccommodation"
              options={['yes', 'no']}
              value={draft.hasAccommodation ? 'yes' : 'no'}
              labelFor={(v) => t(`common.${v}`)}
              onPick={(v) => changeDraft({ hasAccommodation: v === 'yes' })}
            />
          </Field>
        </div>
        {stayViolation && (
          <p role="alert" className="mt-4 rounded-lg border border-danger-500/40 bg-danger-50 p-3 text-sm text-danger-700">
            {t(`registrationDetail.stayInvalid.${stayViolation}`)}
          </p>
        )}
      </section>

      {/* ─── Participants ─── */}
      <section className="section-card">
        <div className="flex items-center justify-between">
          <SectionHeading className="mb-0">{t('registrationDetail.participants')}</SectionHeading>
          <span className="text-sm tabular-nums text-neutral-500">
            {draft.participants.length}/{MAX_PARTICIPANTS}
          </span>
        </div>

        {deadlinePassed && (
          <p className="mt-4 rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm text-neutral-800">
            {t('registrationDetail.deadlinePassed')}
          </p>
        )}

        <div className="mt-5 space-y-4">
          {draft.participants.map((p, i) => {
            const flaggedHere = p.mealIds.filter(isFlagged)
            // Greyed stored figure until the server answers (never for a new person).
            const subtotal = current?.subtotals[i] ?? (unchangedPrices ? data.participants[i]?.totalPrice : undefined)
            const onlyOne = draft.participants.length <= 1
            return (
              <div key={p.key} data-testid={`participant-${i}`} className={`participant-card ${i % 2 === 1 ? 'bg-gold-50' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-serif text-lg font-semibold text-neutral-900">
                    {t('registrationDetail.participantNumber', { number: i + 1 })}
                    {!p.id && (
                      <span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 align-middle text-xs font-medium text-primary-700">
                        {t('registrationDetail.newParticipant')}
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeParticipant(p.key)}
                    disabled={onlyOne}
                    title={onlyOne ? t('registrationDetail.lastParticipantNote') : undefined}
                    className="text-sm font-medium text-danger-600 transition hover:text-danger-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('registrationDetail.removeParticipant')}
                  </button>
                </div>
                {onlyOne && (
                  <p className="mt-1 text-xs text-neutral-500">{t('registrationDetail.lastParticipantNote')}</p>
                )}

                <div className="mt-4 form-field">
                  <label className="form-label" htmlFor={`fullName-${p.key}`}>
                    {t('registrationDetail.fullName')}
                  </label>
                  <input
                    id={`fullName-${p.key}`}
                    type="text"
                    className="bdc-input"
                    autoComplete="off"
                    maxLength={100}
                    value={p.fullName}
                    onChange={(e) => changeParticipant(p.key, { fullName: e.target.value })}
                  />
                  {p.fullName.length < 2 && (
                    <p className="mt-1 text-sm text-danger-600">{t('registrationDetail.fullNameError')}</p>
                  )}
                </div>

                <Field label={t('registrationDetail.ageCategory')}>
                  <Pills
                    name={`age-${p.key}`}
                    options={AGES}
                    value={p.ageCategory}
                    labelFor={(v) => t(`age.${v}`)}
                    onPick={(v) => changeParticipant(p.key, { ageCategory: v as Age })}
                  />
                </Field>

                {(showTier(participationTiers, p.pricingType) || showTier(mealTiers, p.mealPricingType)) && (
                  <div className="form-field grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {showTier(participationTiers, p.pricingType) && (
                      <TierSelect
                        id={`tier-participation-${p.key}`}
                        label={t('registrationDetail.participationPriceType')}
                        value={p.pricingType}
                        options={optionsFor(participationTiers, p.pricingType)}
                        optionLabel={(v) => t(`pricingType.${v}`)}
                        onChange={(v) => changeParticipant(p.key, { pricingType: v })}
                      />
                    )}
                    {showTier(mealTiers, p.mealPricingType) && (
                      <TierSelect
                        id={`tier-meal-${p.key}`}
                        label={t('registrationDetail.mealPriceType')}
                        value={p.mealPricingType}
                        options={optionsFor(mealTiers, p.mealPricingType)}
                        optionLabel={(v) => t(`pricingType.${v}`)}
                        onChange={(v) => changeParticipant(p.key, { mealPricingType: v })}
                      />
                    )}
                  </div>
                )}

                <Field label={t('registrationDetail.mealTypeLabel')}>
                  <Pills
                    name={`diet-${p.key}`}
                    options={DIETS}
                    value={p.mealType}
                    labelFor={(v) => t(`mealCategory.${v}`)}
                    onPick={(v) => changeParticipant(p.key, { mealType: v as Diet })}
                  />
                </Field>

                <Field label={t('registrationDetail.meals')}>
                  <MealGrid
                    participantKey={p.key}
                    dates={sortedDates}
                    meals={ev.meals}
                    selected={p.mealIds}
                    isOffered={(m) => presentFor.has(m.id) && !m.isClosed}
                    isFlagged={isFlagged}
                    priceOf={(m) =>
                      resolveMealPrice(
                        m.mealType,
                        { ageCategory: p.ageCategory, mealPricingType: p.mealPricingType },
                        ev.mealPricingRules,
                        m.price,
                      )
                    }
                    dayLabel={dayLabel}
                    mealLabel={(m) => t(`mealType.${m.mealType}`)}
                    outsideLabel={t('registrationDetail.outsideStay')}
                    emptyLabel={t('registrationDetail.noMealsInStay')}
                    onToggle={(mealId) => toggleMeal(p.key, mealId)}
                  />
                  {flaggedHere.length > 0 && (
                    <p role="alert" className="mt-2 text-sm text-danger-700">
                      {t('registrationDetail.outsideStayNote')}
                    </p>
                  )}
                </Field>

                <div className="price-field mt-4">
                  <span className="text-sm text-neutral-700">{t('registrationDetail.participantPrice')}</span>
                  <span className={`price-amount ${current ? '' : 'opacity-50'}`} data-testid={`subtotal-${i}`}>
                    {subtotal != null ? `${subtotal} CZK` : '…'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 border-t border-neutral-200 pt-5">
          <button
            type="button"
            onClick={addParticipant}
            disabled={draft.participants.length >= MAX_PARTICIPANTS}
            className="btn-secondary w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {t('registrationDetail.addParticipant')}
          </button>
          {draft.participants.length >= MAX_PARTICIPANTS && (
            <p className="mt-2 text-xs text-neutral-500">{t('registrationDetail.maxParticipantsNote')}</p>
          )}
        </div>
      </section>

      {/* ─── Status, price, save / resend ─── */}
      <section className="section-card space-y-5">
        {toast && (
          <div role="status" className="rounded-lg border border-success-500/40 bg-success-50 p-3 text-sm text-success-700">
            {toast}
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 p-3 text-sm text-danger-700">
            {error.message}
            {error.reload && (
              <button
                type="button"
                onClick={() => startRefresh(() => router.refresh())}
                className="ml-2 font-medium underline underline-offset-2"
              >
                {t('registrationDetail.reload')}
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
          <div>
            <label htmlFor="status" className="form-label">
              {t('registrationDetail.status')}
            </label>
            <select
              id="status"
              className="bdc-input w-auto"
              value={status}
              onChange={(e) => {
                setStatusPickedAt(priceKey)
                changeDraft({ status: e.target.value as AdminRegistrationStatus })
              }}
            >
              {REG_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`regStatus.${s}`)}
                </option>
              ))}
            </select>
            {autoSwitched && <p className="mt-2 text-sm text-neutral-600">{t('registrationDetail.paidSwitched')}</p>}
          </div>

          <div className="md:text-right">
            <p className="text-sm font-medium text-neutral-600">{t('registrationDetail.priceTotal')}</p>
            <p
              data-testid="total-price"
              className={`mt-1 font-serif text-4xl font-semibold tabular-nums text-primary-600 ${current ? '' : 'opacity-50'}`}
            >
              {shownTotal} CZK
            </p>
            {calculating && <p className="mt-1 text-xs text-neutral-400">{t('registrationDetail.calculating')}</p>}
            {priceBlocked && current === null && (
              <p className="mt-1 text-xs text-danger-600">{t('registrationDetail.priceUnavailable')}</p>
            )}
            {previewFailed && !priceBlocked && (
              <p className="mt-1 text-xs text-danger-600">
                {t('registrationDetail.priceFailed')}{' '}
                <button type="button" onClick={retryPrice} className="font-medium underline underline-offset-2">
                  {t('registrationDetail.priceRetry')}
                </button>
              </p>
            )}
          </div>
        </div>

        {dirty && <p className="text-center text-sm text-neutral-600">{t('registrationDetail.unsaved')}</p>}

        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveDisabled}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('registrationDetail.save')}
          </button>
          {dirty && (
            <button type="button" onClick={discard} disabled={working} className="btn-secondary disabled:opacity-50">
              {t('registrationDetail.discard')}
            </button>
          )}
          <button
            type="button"
            onClick={handleResend}
            disabled={working || cancelled || dirty}
            title={cancelled ? t('registrationDetail.resendCancelled') : dirty ? t('registrationDetail.resendNeedsSave') : undefined}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('registrationDetail.resend')}
          </button>
        </div>
        {/* A disabled button needs its reason beside it. Keyed off the SELECTED
            status: confirming a booking being cancelled is the same contradiction
            one save later, and the server refuses on the stored one anyway (M47). */}
        {cancelled ? (
          <p className="pt-2 text-center text-sm text-neutral-500">{t('registrationDetail.resendCancelled')}</p>
        ) : dirty ? (
          <p className="pt-2 text-center text-sm text-neutral-500">{t('registrationDetail.resendNeedsSave')}</p>
        ) : null}
      </section>

      {/* Running total on a phone, where the section above is far below the fold. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-neutral-200 bg-white/95 px-5 py-3 backdrop-blur md:hidden">
        <span className="text-sm text-neutral-600">{t('registrationDetail.priceTotal')}</span>
        <span className={`font-mono text-lg tabular-nums text-primary-600 ${current ? '' : 'opacity-50'}`}>
          {shownTotal} CZK
        </span>
      </div>
    </div>
  )
}

function stayViolationOf(d: Pick<Draft, 'arrivalDateId' | 'arrivalTime' | 'departureDateId' | 'earlyDeparture'>, orderById: Map<string, number>) {
  return checkStayOrder({
    arrivalSortOrder: orderById.get(d.arrivalDateId) ?? 0,
    departureSortOrder: orderById.get(d.departureDateId) ?? 0,
    arrivalTime: d.arrivalTime,
    earlyDeparture: d.earlyDeparture,
  })
}

// ─── Presentational helpers ───────────────────────────────────────────────────

function SectionHeading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mb-5 ${className}`}>
      <h2 className="font-serif text-xl font-semibold text-neutral-900">{children}</h2>
      <div className="mt-2 h-0.5 w-10 rounded bg-primary-500" />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="form-field">
      <span className="form-label">{label}</span>
      {children}
    </div>
  )
}

// A controlled pill radio group: the same visually hidden `peer` input +
// `pill-label` the public form uses, so the two screens look alike without the
// admin editor importing (or reshaping) the public form.
function Pills({
  name,
  options,
  value,
  labelFor,
  onPick,
  isDisabled,
}: {
  name: string
  options: readonly string[]
  value: string
  labelFor: (value: string) => string
  onPick: (value: string) => void
  isDisabled?: (value: string) => boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const domId = `${name}-${opt}`
        const disabled = isDisabled?.(opt) ?? false
        return (
          <div key={opt}>
            <input
              type="radio"
              id={domId}
              name={name}
              value={opt}
              checked={value === opt}
              disabled={disabled}
              onChange={() => onPick(opt)}
              className="peer sr-only"
            />
            <label htmlFor={domId} className={`pill-label ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
              {labelFor(opt)}
            </label>
          </div>
        )
      })}
    </div>
  )
}

// Meals by day: the slots this person can have (inside their stay, served that
// day), each priced for THEM at their meal tier — plus any ticked slot they can
// NOT have, shown ticked and flagged so it can be unticked, never silently hidden.
function MealGrid({
  participantKey,
  dates,
  meals,
  selected,
  isOffered,
  isFlagged,
  priceOf,
  dayLabel,
  mealLabel,
  outsideLabel,
  emptyLabel,
  onToggle,
}: {
  participantKey: string
  dates: EventDateDTO[]
  meals: EventMealDTO[]
  selected: string[]
  isOffered: (m: EventMealDTO) => boolean
  isFlagged: (mealId: string) => boolean
  priceOf: (m: EventMealDTO) => number
  dayLabel: (d: EventDateDTO) => string
  mealLabel: (m: EventMealDTO) => string
  outsideLabel: string
  emptyLabel: string
  onToggle: (mealId: string) => void
}) {
  const days = dates
    .map((d) => ({
      day: d,
      slots: meals
        .filter((m) => m.eventDateId === d.id && (isOffered(m) || selected.includes(m.id)))
        .sort((a, b) => (MEAL_ORDER[a.mealType] ?? 0) - (MEAL_ORDER[b.mealType] ?? 0)),
    }))
    .filter((x) => x.slots.length > 0)

  if (days.length === 0) return <p className="text-sm text-neutral-500">{emptyLabel}</p>

  return (
    <div className="space-y-4">
      {days.map(({ day, slots }) => (
        <div key={day.id}>
          <p className="text-sm font-medium text-neutral-600">{dayLabel(day)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {slots.map((m) => {
              const domId = `meal-${participantKey}-${m.id}`
              const flagged = isFlagged(m.id)
              return (
                <div key={m.id}>
                  <input
                    type="checkbox"
                    id={domId}
                    checked={selected.includes(m.id)}
                    onChange={() => onToggle(m.id)}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={domId}
                    data-flagged={flagged || undefined}
                    className={`pill-label cursor-pointer ${flagged ? 'border-danger-500 bg-danger-50 text-danger-700 peer-checked:border-danger-500 peer-checked:bg-danger-50 peer-checked:text-danger-700' : ''}`}
                  >
                    {mealLabel(m)} · {priceOf(m)} CZK
                    {flagged && <span className="ml-1 text-xs font-medium">({outsideLabel})</span>}
                  </label>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// Plain labelled select — two per participant stay readable where pills would not.
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
  value: Tier
  options: readonly Tier[]
  optionLabel: (value: Tier) => string
  onChange: (value: Tier) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-neutral-500">
        {label}
      </label>
      <select id={id} className="bdc-input w-full" value={value} onChange={(e) => onChange(e.target.value as Tier)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
    </div>
  )
}
