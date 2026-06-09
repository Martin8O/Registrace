// Derives the list of event days from a start/end date (inclusive) and the
// default per-meal prices. Used by the admin event form: the admin picks only
// the start and end dates; every day in between is an event day with the three
// standard meals (admin then excludes meals at the edges to set the effective
// start/end meal). Default meal prices are prefilled and editable (real pricing
// lands in B7). Day labels are weekday + d.m. (e.g. "Pátek 13.6.").

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER'

export type EventDay = {
  date: string // ISO yyyy-mm-dd
  label_cs: string
  label_en: string
}

const WEEKDAYS_CS = [
  'Neděle',
  'Pondělí',
  'Úterý',
  'Středa',
  'Čtvrtek',
  'Pátek',
  'Sobota',
]
const WEEKDAYS_EN = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export const MEAL_TYPES: MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER']

// Default catalogue meal prices (whole CZK). Prefill only — B7 pricing engine
// supplies the real defaults; admin can override per meal in the form.
export const DEFAULT_MEAL_PRICE: Record<MealType, number> = {
  BREAKFAST: 80,
  LUNCH: 120,
  DINNER: 120,
}

export function todayISO(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(
    n.getDate(),
  ).padStart(2, '0')}`
}

// Enumerate every day from start to end (inclusive). Returns [] for empty /
// invalid input or when end < start. Parsed at local midnight so the calendar
// day is stable regardless of timezone.
export function enumerateEventDays(startISO: string, endISO: string): EventDay[] {
  if (!startISO || !endISO) return []
  const start = new Date(`${startISO}T00:00:00`)
  const end = new Date(`${endISO}T00:00:00`)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return []

  const days: EventDay[] = []
  const cur = new Date(start)
  let guard = 0
  while (cur <= end && guard < 366) {
    const dow = cur.getDay()
    const d = cur.getDate()
    const m = cur.getMonth() + 1
    const iso = `${cur.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({
      date: iso,
      label_cs: `${WEEKDAYS_CS[dow] ?? ''} ${d}.${m}.`,
      label_en: `${WEEKDAYS_EN[dow] ?? ''} ${d}.${m}.`,
    })
    cur.setDate(cur.getDate() + 1)
    guard++
  }
  return days
}
