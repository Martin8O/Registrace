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

// `mealPricingType` is the SECOND, independent tier (M40): it prices the meals
// while `pricingType` prices the stay. Left undefined by default so the many
// pre-M40 cases below read exactly as they did.
const adult = (
  pricingType = "STANDARD",
  mealIds: string[] = [],
  mealPricingType?: string,
): PricingParticipantInput => ({
  ageCategory: "AGE_15_PLUS",
  pricingType,
  mealPricingType,
  mealIds,
});

// One participant's breakdown for the given input.
const one = (p: PricingParticipantInput, overrides: Partial<PricingInput> = {}) =>
  calculatePricing(input([p], overrides)).participants[0];

// ─── Children: participation is DATA-DRIVEN (revised invariant 15) ─────────────
// No age is hard-coded to 0. A child pays 0 only because its rule's dailyRate is
// 0 (or no rule matches). The default fixture defines only 15+ rules, so children
// fall through to "no rule → 0".

describe("children pay no participation when their rule rate is 0 / absent", () => {
  it("AGE_0_3 → 0 (no matching rule)", () => {
    expect(one({ ageCategory: "AGE_0_3", pricingType: "SURPLUS", mealIds: [] })?.participationPrice).toBe(0);
  });
  it("AGE_4_7 → 0 (no matching rule)", () => {
    expect(one({ ageCategory: "AGE_4_7", mealIds: [] })?.participationPrice).toBe(0);
  });
  it("AGE_8_14 → 0 (no matching rule)", () => {
    expect(one({ ageCategory: "AGE_8_14", mealIds: [] })?.participationPrice).toBe(0);
  });
  it("AGE_8_14 with an explicit 0-rate rule → 0", () => {
    const rules = [{ ageCategory: "AGE_8_14", pricingType: "STANDARD", dailyRate: 0, ...discounts, nightRate: 0, morningArrivalDiscount: 0, afternoonArrivalDiscount: 0, eveningArrivalDiscount: 0, earlyDepartureDiscount: 0 }];
    expect(one({ ageCategory: "AGE_8_14", mealIds: [] }, { pricingRules: rules })?.participationPrice).toBe(0);
  });
  it("a child still pays for selected meals", () => {
    expect(one({ ageCategory: "AGE_8_14", mealIds: ["m_b", "m_l"] })).toEqual({
      participationPrice: 0,
      mealPrice: 200,
      subtotal: 200,
    });
  });
});

// ─── Ages 8–14 ARE charged when the event configures a non-zero rate ──────────
// Mirrors the real BDC "MLK" course (8–14 daily 100, no discounts, night 0).

describe("ages 8–14 follow their configured rate", () => {
  // 8–14 rule carries a real dailyRate but zero discounts/night (discounts are a
  // 15+-only concept, expressed as zeros on the child rule, not an engine branch).
  const child814 = [
    {
      ageCategory: "AGE_8_14", pricingType: "STANDARD", dailyRate: 100, nightRate: 0,
      morningArrivalDiscount: 0, afternoonArrivalDiscount: 0, eveningArrivalDiscount: 0, earlyDepartureDiscount: 0,
    },
  ];
  it("charged dailyRate × days → 100 × 3 = 300", () => {
    expect(one({ ageCategory: "AGE_8_14", mealIds: [] }, { pricingRules: child814 })?.participationPrice).toBe(300);
  });
  it("no arrival discount applied (rule discounts are 0) → still 100 × 3 = 300", () => {
    expect(
      one({ ageCategory: "AGE_8_14", mealIds: [] }, { pricingRules: child814, arrivalTime: "EVENING" })?.participationPrice,
    ).toBe(300);
  });
  it("no night charge even with accommodation (nightRate 0) → 100 × 2 = 200", () => {
    expect(
      one({ ageCategory: "AGE_8_14", mealIds: [] }, {
        pricingRules: child814,
        departureDateId: "d_sat",
        hasAccommodation: true,
      })?.participationPrice,
    ).toBe(200);
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

// ─── Meal price list: meal type × age × tier (invariant 21, M37) ───────────────
// Before this, a meal cost the same for everybody. The fixture prices breakfast at
// 80 for a standard adult, 40 for a 4–7 child, and 20 on the supported tier, so a
// wrong lookup on any of the three axes produces a distinguishable number.

describe("meal price is data-driven by age and tier", () => {
  const mealPricingRules = [
    { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", price: 80 },
    { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", price: 50 },
    { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SURPLUS", price: 110 },
    { mealType: "BREAKFAST", ageCategory: "AGE_4_7", pricingType: "STANDARD", price: 40 },
    { mealType: "BREAKFAST", ageCategory: "AGE_4_7", pricingType: "SUPPORTED", price: 20 },
    { mealType: "LUNCH", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", price: 120 },
    { mealType: "LUNCH", ageCategory: "AGE_4_7", pricingType: "STANDARD", price: 60 },
  ];
  const withRules = (o: Partial<PricingInput> = {}) => ({ mealPricingRules, ...o });

  it("an adult pays the 15+/STANDARD price → 80", () => {
    expect(one(adult("STANDARD", ["m_b"]), withRules())?.mealPrice).toBe(80);
  });
  it("a child pays the child price for the SAME meal → 40", () => {
    expect(
      one({ ageCategory: "AGE_4_7", pricingType: "STANDARD", mealIds: ["m_b"] }, withRules())?.mealPrice,
    ).toBe(40);
  });
  it("the meal tier changes an adult's meal price → SUPPORTED 50, SURPLUS 110", () => {
    expect(one(adult("STANDARD", ["m_b"], "SUPPORTED"), withRules())?.mealPrice).toBe(50);
    expect(one(adult("STANDARD", ["m_b"], "SURPLUS"), withRules())?.mealPrice).toBe(110);
  });
  it("the meal tier changes a CHILD's meal price too → supported 4–7 pays 20", () => {
    expect(
      one(
        { ageCategory: "AGE_4_7", pricingType: "STANDARD", mealPricingType: "SUPPORTED", mealIds: ["m_b"] },
        withRules(),
      )?.mealPrice,
    ).toBe(20);
  });
  it("sums several meals at that participant's own prices → child 40 + 60 = 100", () => {
    expect(
      one({ ageCategory: "AGE_4_7", pricingType: "STANDARD", mealIds: ["m_b", "m_l"] }, withRules())?.mealPrice,
    ).toBe(100);
  });
  it("a closed slot is still free regardless of the price list", () => {
    expect(one(adult("STANDARD", ["m_d"]), withRules())?.mealPrice).toBe(0);
  });
  it("duplicate meal ids are charged once → 80, not 160", () => {
    expect(one(adult("STANDARD", ["m_b", "m_b"]), withRules())?.mealPrice).toBe(80);
  });
  it("omitted pricingType defaults to STANDARD → 80", () => {
    expect(one({ ageCategory: "AGE_15_PLUS", mealIds: ["m_b"] }, withRules())?.mealPrice).toBe(80);
  });

  // The one case where a combination is absent from a list that DOES exist: the
  // fallback must NOT kick in, or a gap in the price list would silently bill the
  // adult flat price to a child.
  it("a combination missing from an existing price list → 0, not the flat price", () => {
    expect(
      one(
        { ageCategory: "AGE_4_7", pricingType: "STANDARD", mealPricingType: "SURPLUS", mealIds: ["m_b"] },
        withRules(),
      )?.mealPrice,
    ).toBe(0);
  });

  it("counts into the subtotal and the total", () => {
    const r = calculatePricing(
      input([adult("STANDARD", ["m_b"]), { ageCategory: "AGE_4_7", pricingType: "STANDARD", mealIds: ["m_b"] }], withRules()),
    );
    expect(r.participants).toEqual([
      { participationPrice: 300, mealPrice: 80, subtotal: 380 },
      { participationPrice: 0, mealPrice: 40, subtotal: 40 },
    ]);
    expect(r.totalPrice).toBe(420);
  });
});

// ─── Two independent tiers (M40) ──────────────────────────────────────────────
// The stay is priced by the participation tier, the meals by the meal tier, and
// neither is derived from the other — someone may take a surplus room and eat at
// the supported price. The fixture gives every tier a distinct number on both
// halves, so a crossed wire cannot pass by coincidence.

describe("participation and meals read two independent tiers", () => {
  const mealPricingRules = [
    { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", price: 80 },
    { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", price: 50 },
    { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SURPLUS", price: 110 },
  ];
  const withRules = (o: Partial<PricingInput> = {}) => ({ mealPricingRules, ...o });

  it("surplus stay with supported meals → 200×3 stay, 50 meals", () => {
    expect(one(adult("SURPLUS", ["m_b"], "SUPPORTED"), withRules())).toEqual({
      participationPrice: 600,
      mealPrice: 50,
      subtotal: 650,
    });
  });

  it("supported stay with surplus meals → 30×3 stay, 110 meals", () => {
    expect(one(adult("SUPPORTED", ["m_b"], "SURPLUS"), withRules())).toEqual({
      participationPrice: 90,
      mealPrice: 110,
      subtotal: 200,
    });
  });

  it("moving only the meal tier leaves the stay price alone", () => {
    const stay = (mealTier: string) =>
      one(adult("STANDARD", ["m_b"], mealTier), withRules())?.participationPrice;
    expect([stay("STANDARD"), stay("SUPPORTED"), stay("SURPLUS")]).toEqual([300, 300, 300]);
  });

  it("moving only the stay tier leaves the meal price alone", () => {
    const meal = (stayTier: string) =>
      one(adult(stayTier, ["m_b"], "SUPPORTED"), withRules())?.mealPrice;
    expect([meal("STANDARD"), meal("SUPPORTED"), meal("SURPLUS")]).toEqual([50, 50, 50]);
  });

  it("takes the meal tier literally — an absent one is NOT inferred from the stay tier", () => {
    // A supported stay with no meal tier resolves to the STANDARD meal price here.
    // Substituting the stay tier is deliberately the caller's job (submit and
    // calculate-price do it), which keeps this file a pure table lookup and keeps
    // the two choices unlinked wherever a real choice exists.
    expect(one(adult("SUPPORTED", ["m_b"]), withRules())?.mealPrice).toBe(80);
  });
});

// ─── Legacy events with no price list keep their old flat pricing ──────────────
// Every event predating M37 charged one price per meal to everyone. Those events
// must keep billing exactly that, for every age and tier — the guarantee the
// migration's backfill and this fallback jointly make.

// it.each (not a for loop) so lib/readme-claims.test.ts counts these four cases:
// its AST counter models it.each and expands it, but sees a loop-wrapped it() as
// a single literal and would undercount the suite in the README.
describe("an event with no meal price list falls back to the flat price", () => {
  it.each([
    ["absent", undefined],
    ["empty", []],
  ])("adult pays the flat slot price when the list is %s → 80 + 120 = 200", (_what, rules) => {
    expect(
      one(adult("STANDARD", ["m_b", "m_l"]), { mealPricingRules: rules as never })?.mealPrice,
    ).toBe(200);
  });

  it.each([
    ["absent", undefined],
    ["empty", []],
  ])("a child pays that same flat price when the list is %s → 80", (_what, rules) => {
    expect(
      one({ ageCategory: "AGE_4_7", pricingType: "SUPPORTED", mealIds: ["m_b"] }, {
        mealPricingRules: rules as never,
      })?.mealPrice,
    ).toBe(80);
  });
});
