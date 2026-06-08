// Pure helper — given the §1 stay selections + the event's dates/meals, returns
// the set of meal-slot ids the participant is actually present for. This is UI
// gating (which meal checkboxes to show), NOT pricing. No DB, no side effects.
//
// Rules (see B5 spec):
//  - Date range: present only on dates within [arrival, departure] inclusive (by sortOrder).
//  - Arrival-day gate (arrivalTime): MORNING → all · AFTERNOON → no breakfast · EVENING → dinner only.
//  - Departure-day gate (earlyDeparture): NONE → all · AFTER_BREAKFAST → breakfast only.
//  - Single-day stay (arrival === departure): both gates apply (intersection).
//  - `isClosed` is handled separately in the UI (shown but disabled) — not here.

import type { MealType, MockEventDate, MockMealSlot } from '@/lib/mock/registrationOptions'

export type ArrivalTime = 'MORNING' | 'AFTERNOON' | 'EVENING'
export type EarlyDeparture = 'NONE' | 'AFTER_BREAKFAST'

export type StaySelection = {
  arrivalDateId: string
  arrivalTime: ArrivalTime
  departureDateId: string
  earlyDeparture: EarlyDeparture
}

function passesArrivalGate(time: ArrivalTime, meal: MealType): boolean {
  switch (time) {
    case 'MORNING':
      return true
    case 'AFTERNOON':
      return meal !== 'BREAKFAST'
    case 'EVENING':
      return meal === 'DINNER'
  }
}

function passesDepartureGate(early: EarlyDeparture, meal: MealType): boolean {
  return early === 'NONE' ? true : meal === 'BREAKFAST'
}

export function getAvailableMealIds(
  stay: StaySelection,
  dates: MockEventDate[],
  meals: MockMealSlot[],
): Set<string> {
  const sortOrderById = new Map(dates.map((d) => [d.id, d.sortOrder]))

  const arrivalOrder = sortOrderById.get(stay.arrivalDateId)
  const departureOrder = sortOrderById.get(stay.departureDateId)

  // Incomplete or unknown selection → nothing selectable yet.
  if (arrivalOrder === undefined || departureOrder === undefined) return new Set()

  const available = new Set<string>()

  for (const slot of meals) {
    const slotOrder = sortOrderById.get(slot.eventDateId)
    if (slotOrder === undefined) continue

    // Date range (inclusive).
    if (slotOrder < arrivalOrder || slotOrder > departureOrder) continue

    // Arrival- and departure-day gates. On a single-day stay both apply.
    if (slotOrder === arrivalOrder && !passesArrivalGate(stay.arrivalTime, slot.mealType)) continue
    if (slotOrder === departureOrder && !passesDepartureGate(stay.earlyDeparture, slot.mealType)) continue

    available.add(slot.id)
  }

  return available
}
