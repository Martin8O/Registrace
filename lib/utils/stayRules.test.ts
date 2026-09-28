import { describe, it, expect } from 'vitest'
import { checkStayOrder, STAY_RULE_MESSAGES } from './stayRules'

// The three stay-order rules, shared by the public submit and the admin full edit
// since M50. Exhaustive over what matters: day order × same day × arrival time ×
// early departure.

const stay = (over: Partial<Parameters<typeof checkStayOrder>[0]> = {}) => ({
  arrivalSortOrder: 1,
  departureSortOrder: 3,
  arrivalTime: 'MORNING' as const,
  earlyDeparture: 'NONE' as const,
  ...over,
})

describe('checkStayOrder', () => {
  it('accepts an ordinary multi-day stay with any arrival time and either departure', () => {
    for (const arrivalTime of ['MORNING', 'AFTERNOON', 'EVENING'] as const) {
      for (const earlyDeparture of ['NONE', 'AFTER_BREAKFAST'] as const) {
        expect(checkStayOrder(stay({ arrivalTime, earlyDeparture }))).toBeNull()
      }
    }
  })

  it('refuses a departure before the arrival', () => {
    expect(checkStayOrder(stay({ arrivalSortOrder: 3, departureSortOrder: 2 }))).toBe('departure_before_arrival')
  })

  it('refuses an evening arrival on a same-day stay, whatever the departure', () => {
    for (const earlyDeparture of ['NONE', 'AFTER_BREAKFAST'] as const) {
      expect(checkStayOrder(stay({ departureSortOrder: 1, arrivalTime: 'EVENING', earlyDeparture }))).toBe(
        'same_day_evening_arrival',
      )
    }
  })

  it('same day, leaving after breakfast: only a morning arrival makes sense', () => {
    const sameDay = { departureSortOrder: 1, earlyDeparture: 'AFTER_BREAKFAST' as const }
    expect(checkStayOrder(stay({ ...sameDay, arrivalTime: 'MORNING' }))).toBeNull()
    expect(checkStayOrder(stay({ ...sameDay, arrivalTime: 'AFTERNOON' }))).toBe('same_day_early_departure_needs_morning')
  })

  it('same day, staying to the end: morning and afternoon arrivals are fine', () => {
    expect(checkStayOrder(stay({ departureSortOrder: 1, arrivalTime: 'MORNING' }))).toBeNull()
    expect(checkStayOrder(stay({ departureSortOrder: 1, arrivalTime: 'AFTERNOON' }))).toBeNull()
  })

  it('keeps the messages the public submit has always logged', () => {
    expect(STAY_RULE_MESSAGES).toEqual({
      departure_before_arrival: 'Departure cannot precede arrival',
      same_day_evening_arrival: 'Same-day stay cannot arrive in the evening',
      same_day_early_departure_needs_morning: 'Same-day early departure requires a morning arrival',
    })
  })
})
