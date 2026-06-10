// modules/pricing — the pricing seam.
//
// PURE + SERVER-ONLY, with NO DB access (invariant 2). The output shape is the
// contract every call site already reads (RegistrationForm + the calculate-price
// handler). B7 wires the seam only: this returns 0-valued prices so the whole
// flow is architecturally correct (server-side, recalculated before any DB
// write — invariants 3–4). The real arithmetic + tests land in P5.

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

export function calculatePricing(input: PricingInput): PricingResult {
  // TODO(P5): real engine + tests. Until then every value is 0; the shape is
  // what matters. Discounts are *subtracted* and accommodation adds nightRate ×
  // (days − 1), with the total floored at 0 — see SESSION_BOOTSTRAP §D.7.
  return {
    participants: input.participants.map(() => ({
      participationPrice: 0,
      mealPrice: 0,
      subtotal: 0,
    })),
    totalPrice: 0,
  };
}
