// Pure helper — the stay-ORDER rules, shared by every server path that accepts a
// stay (the public submit and the admin full edit, M50). No DB, no side effects,
// client-safe, so the admin editor can disable exactly the combinations the
// server would refuse.
//
// Rules (unchanged from the public submit, where they were written inline):
//  - departure never precedes arrival (by day sortOrder);
//  - a same-day stay cannot arrive in the evening;
//  - a same-day "after breakfast" departure requires a morning arrival.
//
// Whether the two days belong to the event at all is the caller's check — it
// holds the event's days; this only compares two that do.

import type { ArrivalTime, EarlyDeparture } from '@/lib/utils/mealAvailability'

export type StayRuleViolation =
  | 'departure_before_arrival'
  | 'same_day_evening_arrival'
  | 'same_day_early_departure_needs_morning'

export type StayOrder = {
  arrivalSortOrder: number
  departureSortOrder: number
  arrivalTime: ArrivalTime
  earlyDeparture: EarlyDeparture
}

export function checkStayOrder(stay: StayOrder): StayRuleViolation | null {
  if (stay.departureSortOrder < stay.arrivalSortOrder) return 'departure_before_arrival'
  if (stay.departureSortOrder === stay.arrivalSortOrder) {
    if (stay.arrivalTime === 'EVENING') return 'same_day_evening_arrival'
    if (stay.earlyDeparture === 'AFTER_BREAKFAST' && stay.arrivalTime !== 'MORNING') {
      return 'same_day_early_departure_needs_morning'
    }
  }
  return null
}

// The server-side messages these rules have always carried (submit's 400 body is
// generic, but the messages are what a log line shows).
export const STAY_RULE_MESSAGES: Record<StayRuleViolation, string> = {
  departure_before_arrival: 'Departure cannot precede arrival',
  same_day_evening_arrival: 'Same-day stay cannot arrive in the evening',
  same_day_early_departure_needs_morning: 'Same-day early departure requires a morning arrival',
}
