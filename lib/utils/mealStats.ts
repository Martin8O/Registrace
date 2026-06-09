// Per-day meal counts for a (still-open) event — how many meals the kitchen
// needs to cook. Counts only REGISTERED participants (cancelled don't eat) and
// only meals that are offered (a slot exists and isn't closed). Presentation
// scaffolding: in B7 this aggregates ParticipantMeal rows from the DB.
import type {
  MealType,
  MockEventDate,
  MockMealSlot,
} from '@/lib/mock/registrationOptions'
import type { MockRegistration } from '@/lib/mock/registrations'

export type DayMealStat = {
  dateId: string
  label_cs: string
  label_en: string
  meals: { mealType: MealType; count: number }[]
}

const MEAL_ORDER: Record<MealType, number> = {
  BREAKFAST: 0,
  LUNCH: 1,
  DINNER: 2,
}

export function computeMealStats(
  registrations: MockRegistration[], // already scoped to one event
  dates: MockEventDate[],
  slots: MockMealSlot[],
): DayMealStat[] {
  // Meal selections of every active participant (cancelled registrations excluded).
  const activeMealIdSets = registrations
    .filter((r) => r.status === 'REGISTERED')
    .flatMap((r) => r.participants.map((p) => p.mealIds))

  const sortedDates = [...dates].sort((a, b) => a.sortOrder - b.sortOrder)
  const result: DayMealStat[] = []

  for (const d of sortedDates) {
    const meals = slots
      .filter((s) => s.eventDateId === d.id && !s.isClosed)
      .map((slot) => ({
        mealType: slot.mealType,
        count: activeMealIdSets.filter((ids) => ids.includes(slot.id)).length,
      }))
      .sort((a, b) => MEAL_ORDER[a.mealType] - MEAL_ORDER[b.mealType])

    if (meals.length > 0) {
      result.push({
        dateId: d.id,
        label_cs: d.label_cs,
        label_en: d.label_en,
        meals,
      })
    }
  }

  return result
}
