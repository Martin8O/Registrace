import { describe, it, expect } from "vitest";
import { eventCreateWithRelationsSchema, eventUpdateSchema } from "./events";

// The two independent tier sets an event offers (M40): one for participation /
// accommodation, one for meals. Both are optional — a payload that omits them
// leaves the column default of all three tiers, which is what every event offered
// before M40 — but a set that IS sent has to be usable.

const pricingRule = (pricingType: string) => ({
  ageCategory: "AGE_15_PLUS",
  pricingType,
  dailyRate: 100,
  nightRate: 50,
  morningArrivalDiscount: 0,
  afternoonArrivalDiscount: 0,
  eveningArrivalDiscount: 0,
  earlyDepartureDiscount: 0,
});

const mealRule = (pricingType: string) => ({
  mealType: "BREAKFAST",
  ageCategory: "AGE_15_PLUS",
  pricingType,
  price: 80,
});

const validCreate = {
  centerId: "c1",
  title_cs: "Akce",
  title_en: "Event",
  status: "DRAFT",
  startDate: "2026-05-01",
  endDate: "2026-05-03",
  dates: [{ date: "2026-05-01", label_cs: "Pá", label_en: "Fri", sortOrder: 0 }],
  pricingRules: [pricingRule("STANDARD")],
  mealPricingRules: [mealRule("STANDARD")],
  meals: [{ date: "2026-05-01", mealType: "BREAKFAST", price: 80, isClosed: false }],
};

const parse = (over: Record<string, unknown>) =>
  eventCreateWithRelationsSchema.safeParse({ ...validCreate, ...over });

describe("event pricing tier sets", () => {
  it("accepts a payload that omits both sets (pre-M40 shape → all three tiers)", () => {
    expect(parse({}).success).toBe(true);
  });

  it("accepts two different sets — the two are independent", () => {
    expect(
      parse({
        participationPricingTypes: ["STANDARD", "SURPLUS"],
        mealPricingTypes: ["STANDARD"],
        pricingRules: [pricingRule("STANDARD"), pricingRule("SURPLUS")],
      }).success,
    ).toBe(true);
  });

  it("rejects a set without STANDARD", () => {
    // STANDARD is the stored default for a participant's tier and the fallback in
    // several lookups, so an event that does not offer it is unrepresentable.
    expect(parse({ participationPricingTypes: ["SUPPORTED", "SURPLUS"] }).success).toBe(false);
    expect(parse({ mealPricingTypes: ["SUPPORTED"] }).success).toBe(false);
  });

  it("rejects an empty set", () => {
    expect(parse({ participationPricingTypes: [] }).success).toBe(false);
    expect(parse({ mealPricingTypes: [] }).success).toBe(false);
  });

  it("rejects a participation rule quoting a tier the event does not offer", () => {
    const result = parse({
      participationPricingTypes: ["STANDARD"],
      pricingRules: [pricingRule("STANDARD"), pricingRule("SURPLUS")],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["pricingRules", 1, "pricingType"]);
  });

  it("rejects a meal rule quoting a tier the event does not offer", () => {
    const result = parse({
      mealPricingTypes: ["STANDARD"],
      mealPricingRules: [mealRule("STANDARD"), mealRule("SUPPORTED")],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["mealPricingRules", 1, "pricingType"]);
  });

  it("checks each price list against its OWN set, not the other one", () => {
    // Meals tiered, room not: a surplus MEAL rule is fine even though the
    // participation set is STANDARD-only. Nothing crosses between the two.
    expect(
      parse({
        participationPricingTypes: ["STANDARD"],
        mealPricingTypes: ["STANDARD", "SURPLUS"],
        pricingRules: [pricingRule("STANDARD")],
        mealPricingRules: [mealRule("STANDARD"), mealRule("SURPLUS")],
      }).success,
    ).toBe(true);
  });

  it("applies the same rule to an update payload", () => {
    expect(
      eventUpdateSchema.safeParse({
        mealPricingTypes: ["STANDARD"],
        mealPricingRules: [mealRule("SUPPORTED")],
      }).success,
    ).toBe(false);
  });
});
