import { describe, it, expect } from "vitest";
import { matchesShape } from "./newEventDraft";

const fresh = {
  pricingRules: { "AGE_15_PLUS|STANDARD": { dailyRate: 300, nightRate: 0 } },
  mealExcluded: {},
  tiers: { STANDARD: true },
  dates: [],
};

describe("a restored wizard state's shape", () => {
  it("passes when it has everything the fresh state has, and more where maps grow", () => {
    const restored = {
      pricingRules: { "AGE_15_PLUS|STANDARD": { dailyRate: 450, nightRate: 120 } },
      mealExcluded: { "2099-07-10|LUNCH": true },
      tiers: { STANDARD: true, SURPLUS: false },
      dates: ["2099-07-10"],
    };
    expect(matchesShape(restored, fresh)).toBe(true);
  });

  it("fails on a missing piece the wizard renders from", () => {
    expect(matchesShape({ ...fresh, pricingRules: {} }, fresh)).toBe(false);
    const withoutTiers = { pricingRules: fresh.pricingRules, mealExcluded: fresh.mealExcluded, dates: fresh.dates };
    expect(matchesShape(withoutTiers, fresh)).toBe(false);
  });

  it("fails on a value of another kind, however deep", () => {
    const wrongRate = { ...fresh, pricingRules: { "AGE_15_PLUS|STANDARD": { dailyRate: "300", nightRate: 0 } } };
    expect(matchesShape(wrongRate, fresh)).toBe(false);
    expect(matchesShape({ ...fresh, dates: {} }, fresh)).toBe(false);
    expect(matchesShape({ ...fresh, mealExcluded: null }, fresh)).toBe(false);
  });

  it("fails on something that is not a state at all", () => {
    expect(matchesShape(null, fresh)).toBe(false);
    expect(matchesShape("{}", fresh)).toBe(false);
    expect(matchesShape([], fresh)).toBe(false);
  });
});
