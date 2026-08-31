import { describe, it, expect } from "vitest";
import { resolveMealPrice, effectiveMealPricingType } from "./mealPrice";

// The single definition of "what one meal costs one person", shared by the pricing
// engine, the submit service's price snapshot and the public form's meal pills. It
// has two fallback contracts that must not drift (invariant 21), and since M40 it
// keys on the MEAL tier — the choice a person makes independently of the tier that
// prices their stay.

const RULES = [
  { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", price: 80 },
  { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", price: 50 },
  { mealType: "BREAKFAST", ageCategory: "AGE_4_7", pricingType: "STANDARD", price: 40 },
  { mealType: "LUNCH", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", price: 120 },
];

const FLAT = 999; // the legacy EventMeal.price — absurd on purpose

describe("resolveMealPrice", () => {
  it("picks the row matching meal type, age and meal tier", () => {
    expect(resolveMealPrice("BREAKFAST", { ageCategory: "AGE_15_PLUS", mealPricingType: "SUPPORTED" }, RULES, FLAT)).toBe(50);
    expect(resolveMealPrice("BREAKFAST", { ageCategory: "AGE_4_7", mealPricingType: "STANDARD" }, RULES, FLAT)).toBe(40);
    expect(resolveMealPrice("LUNCH", { ageCategory: "AGE_15_PLUS", mealPricingType: "STANDARD" }, RULES, FLAT)).toBe(120);
  });

  it("defaults an absent meal tier to STANDARD", () => {
    expect(resolveMealPrice("BREAKFAST", { ageCategory: "AGE_15_PLUS" }, RULES, FLAT)).toBe(80);
  });

  it("contract 1 — no price list at all → the event's flat price", () => {
    // Only true of an event predating M37, all of which were backfilled. Keeping
    // it means such a row keeps billing today's price instead of dropping to 0.
    expect(resolveMealPrice("BREAKFAST", { ageCategory: "AGE_15_PLUS" }, undefined, FLAT)).toBe(FLAT);
    expect(resolveMealPrice("BREAKFAST", { ageCategory: "AGE_15_PLUS" }, [], FLAT)).toBe(FLAT);
  });

  it("contract 2 — a gap in a list that EXISTS → 0, never the flat price", () => {
    // The opposite answer would bill a child the adult price whenever the price
    // list has a hole, which is the trap AGENTS.md warns about.
    expect(resolveMealPrice("BREAKFAST", { ageCategory: "AGE_4_7", mealPricingType: "SURPLUS" }, RULES, FLAT)).toBe(0);
    expect(resolveMealPrice("DINNER", { ageCategory: "AGE_15_PLUS", mealPricingType: "STANDARD" }, RULES, FLAT)).toBe(0);
  });
});

describe("effectiveMealPricingType", () => {
  it("uses the meal tier when the payload carries one", () => {
    expect(effectiveMealPricingType({ pricingType: "SURPLUS", mealPricingType: "SUPPORTED" })).toBe("SUPPORTED");
  });

  it("falls back to the participant's OWN stay tier, never to STANDARD", () => {
    // A payload without a meal tier predates M40, when one tier priced both
    // halves — so this reproduces exactly what that person was being charged.
    expect(effectiveMealPricingType({ pricingType: "SUPPORTED" })).toBe("SUPPORTED");
    expect(effectiveMealPricingType({ pricingType: "SURPLUS" })).toBe("SURPLUS");
  });

  it("returns nothing when the payload carries neither, leaving the default to the caller", () => {
    expect(effectiveMealPricingType({})).toBeUndefined();
  });
});
