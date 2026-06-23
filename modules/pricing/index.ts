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
  price: number;
  isClosed: boolean;
};

export type PricingEventDateInput = {
  id: string;
  date: string;
  sortOrder: number;
};

export type PricingInput = {
  participants: PricingParticipantInput[];
  pricingRules: PricingRuleInput[];
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

const CHILD_AGES = new Set(["AGE_0_3", "AGE_4_7", "AGE_8_14"]);

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

// Participation price for one 15+ participant. Children never reach here
// (invariant 15: participation is always 0 for ages 0–14). A missing rule or a
// degenerate stay yields 0 — graceful, never throws.
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
// Applies to every age — children pay for meals even though participation is 0.
function mealPriceFor(participant: PricingParticipantInput, input: PricingInput): number {
  const mealById = new Map(input.meals.map((m) => [m.id, m]));
  let total = 0;
  for (const id of new Set(participant.mealIds)) {
    const meal = mealById.get(id);
    if (meal && !meal.isClosed) total += meal.price;
  }
  return total;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const participants = input.participants.map((p) => {
    const participationPrice = CHILD_AGES.has(p.ageCategory) ? 0 : participationPriceFor(p, input);
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
