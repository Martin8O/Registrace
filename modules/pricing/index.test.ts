import { describe, it, expect } from "vitest";
import { calculatePricing, type PricingInput, type PricingParticipantInput } from "./index";

// ─── Fixture: a 3-day event (Fri/Sat/Sun) ─────────────────────────────────────
// Discounts on the canonical STANDARD rule: morning = 0 (the "neutral" arrival —
// a full first day), afternoon = 50, evening = 100, early departure = 80,
// nightRate = 50. SUPPORTED/SURPLUS share the discounts, differ only on dailyRate.

const eventDates = [
  { id: "d_fri", date: "2026-05-01", sortOrder: 0 },
  { id: "d_sat", date: "2026-05-02", sortOrder: 1 },
  { id: "d_sun", date: "2026-05-03", sortOrder: 2 },
];

const meals = [
  { id: "m_b", eventDateId: "d_fri", mealType: "BREAKFAST", price: 80, isClosed: false },
  { id: "m_l", eventDateId: "d_fri", mealType: "LUNCH", price: 120, isClosed: false },
  { id: "m_d", eventDateId: "d_fri", mealType: "DINNER", price: 120, isClosed: true }, // closed
];

const discounts = {
  morningArrivalDiscount: 0,
  afternoonArrivalDiscount: 50,
  eveningArrivalDiscount: 100,
  earlyDepartureDiscount: 80,
  nightRate: 50,
};

const pricingRules = [
  { ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", dailyRate: 100, ...discounts },
  { ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", dailyRate: 30, ...discounts },
  { ageCategory: "AGE_15_PLUS", pricingType: "SURPLUS", dailyRate: 200, ...discounts },
];

function input(
  participants: PricingParticipantInput[],
  overrides: Partial<PricingInput> = {},
): PricingInput {
  return {
    participants,
    pricingRules,
    meals,
    eventDates,
    arrivalDateId: "d_fri",
    arrivalTime: "MORNING",
    departureDateId: "d_sun", // full 3-day stay by default
    earlyDeparture: "NONE",
    hasAccommodation: false,
    ...overrides,
  };
}

const adult = (pricingType = "STANDARD", mealIds: string[] = []): PricingParticipantInput => ({
  ageCategory: "AGE_15_PLUS",
  pricingType,
  mealIds,
});

// One participant's breakdown for the given input.
const one = (p: PricingParticipantInput, overrides: Partial<PricingInput> = {}) =>
  calculatePricing(input([p], overrides)).participants[0];

// ─── Children: participation always 0 (invariant 15) ──────────────────────────

describe("children pay no participation price", () => {
  it("AGE_0_3 → 0 regardless of pricingType", () => {
    // pricingType is invalid for a child per Zod, but the engine must still zero it.
    expect(one({ ageCategory: "AGE_0_3", pricingType: "SURPLUS", mealIds: [] })?.participationPrice).toBe(0);
  });
  it("AGE_4_7 → 0", () => {
    expect(one({ ageCategory: "AGE_4_7", mealIds: [] })?.participationPrice).toBe(0);
  });
  it("AGE_8_14 → 0", () => {
    expect(one({ ageCategory: "AGE_8_14", mealIds: [] })?.participationPrice).toBe(0);
  });
  it("a child still pays for selected meals", () => {
    expect(one({ ageCategory: "AGE_8_14", mealIds: ["m_b", "m_l"] })).toEqual({
      participationPrice: 0,
      mealPrice: 200,
      subtotal: 200,
    });
  });
});

// ─── 15+ daily rate by pricing type (3-day stay, morning, no discount) ────────

describe("15+ participation = dailyRate × days", () => {
  it("STANDARD, 3-day stay → 100 × 3 = 300", () => {
    expect(one(adult("STANDARD"))?.participationPrice).toBe(300);
  });
  it("SUPPORTED → 30 × 3 = 90", () => {
    expect(one(adult("SUPPORTED"))?.participationPrice).toBe(90);
  });
  it("SURPLUS → 200 × 3 = 600", () => {
    expect(one(adult("SURPLUS"))?.participationPrice).toBe(600);
  });
  it("a 2-day stay scales the daily rate → 100 × 2 = 200", () => {
    expect(one(adult("STANDARD"), { departureDateId: "d_sat" })?.participationPrice).toBe(200);
  });
  it("defaults to STANDARD when pricingType is omitted", () => {
    expect(one({ ageCategory: "AGE_15_PLUS", mealIds: [] })?.participationPrice).toBe(300);
  });
});

// ─── Arrival-time + early-departure discounts (subtracted) ────────────────────

describe("discounts are subtracted", () => {
  it("AFTERNOON arrival subtracts afternoonArrivalDiscount → 300 − 50 = 250", () => {
    expect(one(adult("STANDARD"), { arrivalTime: "AFTERNOON" })?.participationPrice).toBe(250);
  });
  it("EVENING arrival subtracts eveningArrivalDiscount → 300 − 100 = 200", () => {
    expect(one(adult("STANDARD"), { arrivalTime: "EVENING" })?.participationPrice).toBe(200);
  });
  it("MORNING arrival subtracts morningArrivalDiscount (non-zero rule) → 300 − 30 = 270", () => {
    const morningRule = [{ ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", dailyRate: 100, ...discounts, morningArrivalDiscount: 30 }];
    expect(one(adult("STANDARD"), { pricingRules: morningRule, arrivalTime: "MORNING" })?.participationPrice).toBe(270);
  });
  it("AFTER_BREAKFAST early departure subtracts earlyDepartureDiscount → 300 − 80 = 220", () => {
    expect(one(adult("STANDARD"), { earlyDeparture: "AFTER_BREAKFAST" })?.participationPrice).toBe(220);
  });
});

// ─── Accommodation: add nightRate × (days − 1) ────────────────────────────────

describe("accommodation adds nights", () => {
  it("YES → 300 + 50 × (3 − 1) = 400", () => {
    expect(one(adult("STANDARD"), { hasAccommodation: true })?.participationPrice).toBe(400);
  });
  it("NO → nightRate not added → 300", () => {
    expect(one(adult("STANDARD"), { hasAccommodation: false })?.participationPrice).toBe(300);
  });
});

// ─── Meals ────────────────────────────────────────────────────────────────────

describe("meal pricing", () => {
  it("two open meals are summed → 80 + 120 = 200", () => {
    expect(one(adult("STANDARD", ["m_b", "m_l"]))?.mealPrice).toBe(200);
  });
  it("a closed meal in mealIds contributes 0", () => {
    expect(one(adult("STANDARD", ["m_d"]))?.mealPrice).toBe(0);
  });
  it("a duplicate meal id is counted once", () => {
    expect(one(adult("STANDARD", ["m_b", "m_b"]))?.mealPrice).toBe(80);
  });
  it("an unknown meal id is ignored", () => {
    expect(one(adult("STANDARD", ["m_b", "ghost"]))?.mealPrice).toBe(80);
  });
});

// ─── Defensive edges (the engine is also called mid-edit by calculate-price) ──

describe("defensive behaviour", () => {
  it("never goes below 0 (discount exceeds base)", () => {
    const overRule = [{ ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", dailyRate: 100, ...discounts, eveningArrivalDiscount: 200 }];
    // 1-day stay: base 100, evening discount 200 → max(0, −100) = 0.
    const p = one(adult("STANDARD"), { pricingRules: overRule, arrivalTime: "EVENING", departureDateId: "d_fri" });
    expect(p?.participationPrice).toBe(0);
  });
  it("missing matching rule → participation 0", () => {
    expect(one(adult("STANDARD"), { pricingRules: [] })?.participationPrice).toBe(0);
  });
  it("departure before arrival → 0 days → participation 0", () => {
    expect(one(adult("STANDARD"), { arrivalDateId: "d_sun", departureDateId: "d_fri" })?.participationPrice).toBe(0);
  });
  it("unknown stay ids → 0 days → participation 0", () => {
    expect(one(adult("STANDARD"), { arrivalDateId: "x", departureDateId: "y" })?.participationPrice).toBe(0);
  });
});

// ─── Whole-result assertions (hand-derived) ───────────────────────────────────

describe("full result", () => {
  it("combined path: STANDARD, evening, accommodation, 2 meals → subtotal 500", () => {
    // participation = 100×3 − 100 (evening) + 50×2 (accom) = 300; meals = 80 + 120 = 200.
    const r = calculatePricing(
      input([adult("STANDARD", ["m_b", "m_l"])], { arrivalTime: "EVENING", hasAccommodation: true }),
    );
    expect(r.participants[0]).toEqual({ participationPrice: 300, mealPrice: 200, subtotal: 500 });
    expect(r.totalPrice).toBe(500);
  });

  it("totalPrice sums all participants (adult + child with a meal)", () => {
    const r = calculatePricing(
      input([adult("STANDARD"), { ageCategory: "AGE_4_7", mealIds: ["m_b"] }]),
    );
    expect(r.participants).toEqual([
      { participationPrice: 300, mealPrice: 0, subtotal: 300 },
      { participationPrice: 0, mealPrice: 80, subtotal: 80 },
    ]);
    expect(r.totalPrice).toBe(380);
  });
});
