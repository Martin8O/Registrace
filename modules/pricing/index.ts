// modules/pricing — the pricing engine.
//
// PURE + SERVER-ONLY, with NO DB access (invariant 2). The output shape is the
// contract every call site already reads (RegistrationForm + the calculate-price
// handler + the submit service). B7 wired the seam (zeros); P5 fills in the real
// arithmetic in place — no call-site change (decision 14). Prices are always
// recomputed here server-side before any DB write (invariants 3–4). Discounts
// are SUBTRACTED, accommodation adds nightRate × (days − 1), and participation is
// floored at 0 (SESSION_BOOTSTRAP §D.7). All values are whole-CZK integers
// (invariant 10); inputs are already integers, so no rounding is introduced.
//
// BOTH halves of a participant's price are DATA-DRIVEN by (ageCategory,
// pricingType) — no age and no tier is hard-coded anywhere in this file:
//
//  • Participation comes from the matching PricingRule (revised invariant 15,
//    M30). Young children (0–3/4–7) carry a 0-rate rule → 0; ages 8–14 follow the
//    event's configured rate (0 in most events, but real BDC courses charge them,
//    e.g. 100 CZK/day); 15+ uses the tier rate. Arrival/early-departure discounts
//    apply only to 15+ purely because child rules carry 0 discounts — not via any
//    age branch here.
//
//  • Meals come from the matching MealPricingRule (invariant 21, M37). Before it,
//    a meal cost the same for everyone, so a child's lunch could not be cheaper
//    and the supported/surplus tiers priced only participation. The tier now
//    applies at every age (revised invariant 15 again), which is why the lookup
//    keys on both fields for meals exactly as it does for participation.
//
// An event with NO meal price list at all falls back to the flat EventMeal.price
// (invariant 21) — that is what every event charged before M37, so a row the
// backfill somehow missed keeps billing today's price instead of silently
// dropping to 0. The fallback is per-event, not per-combination: a configured
// event whose 8–14/SURPLUS breakfast is deliberately 0 has a rule saying 0, and
// that 0 is honoured rather than being read as "unpriced".

import { resolveMealPrice } from "@/lib/utils/mealPrice";

export type PricingParticipantInput = {
  ageCategory: string;
  pricingType?: string;
  mealIds: string[];
};

export type PricingRuleInput = {
  ageCategory: string;
  pricingType: string;
  dailyRate: number;
  nightRate: number;
  morningArrivalDiscount: number;
  afternoonArrivalDiscount: number;
  eveningArrivalDiscount: number;
  earlyDepartureDiscount: number;
};

export type PricingMealInput = {
  id: string;
  eventDateId: string;
  mealType: string;
  // Legacy flat price — only consulted for an event with no meal price list.
  price: number;
  isClosed: boolean;
};

export type PricingMealRuleInput = {
  mealType: string;
  ageCategory: string;
  pricingType: string;
  price: number;
};

export type PricingEventDateInput = {
  id: string;
  date: string;
  sortOrder: number;
};

export type PricingInput = {
  participants: PricingParticipantInput[];
  pricingRules: PricingRuleInput[];
  // The event's meal price list. Optional so a caller that predates M37 (and any
  // event without one) still prices meals at the flat PricingMealInput.price.
  mealPricingRules?: PricingMealRuleInput[];
  meals: PricingMealInput[];
  eventDates: PricingEventDateInput[];
  arrivalDateId: string;
  arrivalTime: string;
  departureDateId: string;
  earlyDeparture: string;
  hasAccommodation: boolean;
};

export type PricingResultParticipant = {
  participationPrice: number;
  mealPrice: number;
  subtotal: number;
};

export type PricingResult = {
  participants: PricingResultParticipant[];
  totalPrice: number;
};

// Inclusive day count between the arrival and departure event-dates, by their
// sortOrder. Returns 0 when either id is unknown or the order is degenerate
// (departure before arrival) — calculate-price calls us mid-edit, where the stay
// can be transiently invalid, so the engine must never produce nonsense.
function participationDays(
  arrivalDateId: string,
  departureDateId: string,
  eventDates: PricingEventDateInput[],
): number {
  const order = new Map(eventDates.map((d) => [d.id, d.sortOrder]));
  const a = order.get(arrivalDateId);
  const d = order.get(departureDateId);
  if (a === undefined || d === undefined) return 0;
  const days = d - a + 1;
  return days > 0 ? days : 0;
}

// Participation price for one participant, DATA-DRIVEN by the matching PricingRule
// (revised invariant 15 — see header). The rule's dailyRate decides who pays:
// young children (0–3/4–7) carry a 0-rate rule → 0; ages 8–14 follow the event's
// configured rate (0 in most events, but e.g. 100 in a course that charges them);
// 15+ uses the tier rate. Arrival/early-departure discounts and night rate also
// come from the rule, so a category meant to have no discounts simply carries 0s.
// A missing rule or a degenerate stay yields 0 — graceful, never throws.
function participationPriceFor(
  participant: PricingParticipantInput,
  input: PricingInput,
): number {
  const pricingType = participant.pricingType ?? "STANDARD";
  const rule = input.pricingRules.find(
    (r) => r.ageCategory === participant.ageCategory && r.pricingType === pricingType,
  );
  if (!rule) return 0;

  const days = participationDays(input.arrivalDateId, input.departureDateId, input.eventDates);
  if (days <= 0) return 0;

  let price = rule.dailyRate * days;

  // *Discount fields are SUBTRACTED (invariant note).
  if (input.arrivalTime === "MORNING") price -= rule.morningArrivalDiscount;
  else if (input.arrivalTime === "AFTERNOON") price -= rule.afternoonArrivalDiscount;
  else if (input.arrivalTime === "EVENING") price -= rule.eveningArrivalDiscount;

  if (input.earlyDeparture === "AFTER_BREAKFAST") price -= rule.earlyDepartureDiscount;

  // Accommodation adds nights, which is one fewer than the inclusive day count.
  if (input.hasAccommodation) price += rule.nightRate * (days - 1);

  return Math.max(0, price);
}

// Meal price for one participant: sum of each UNIQUE selected meal's price, but
// only for meals that exist on this event and are open. Unknown / closed ids
// contribute 0 (mirrors the submit service, which drops them before persisting).
//
// Each slot is priced for THIS participant's (ageCategory, pricingType) from the
// event's meal price list — so a child's lunch and an adult's lunch on the same
// day cost different amounts (invariant 21). Applies to every age: children pay
// for meals even when their participation is 0.
function mealPriceFor(participant: PricingParticipantInput, input: PricingInput): number {
  const mealById = new Map(input.meals.map((m) => [m.id, m]));
  let total = 0;
  for (const id of new Set(participant.mealIds)) {
    const meal = mealById.get(id);
    if (meal && !meal.isClosed) {
      total += resolveMealPrice(meal.mealType, participant, input.mealPricingRules, meal.price);
    }
  }
  return total;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const participants = input.participants.map((p) => {
    // Both halves are fully data-driven by (ageCategory, pricingType): the
    // PricingRule's dailyRate for participation, the MealPricingRule's price for
    // each meal. No age and no tier is hard-coded here (invariants 15 + 21).
    const participationPrice = participationPriceFor(p, input);
    const mealPrice = mealPriceFor(p, input);
    return {
      participationPrice,
      mealPrice,
      subtotal: participationPrice + mealPrice,
    };
  });

  return {
    participants,
    totalPrice: participants.reduce((sum, p) => sum + p.subtotal, 0),
  };
}
