import { describe, it, expect } from "vitest";
import { registrationSubmitSchema, calculatePriceSchema } from "./registrations";

// A minimal valid submit payload; individual tests override one field to prove
// the corresponding rule rejects it. The schema is the SAME object the backend
// handler parses (single source of truth — P3).
const validSubmit = {
  eventId: "evt1",
  arrivalDateId: "d1",
  arrivalTime: "MORNING",
  departureDateId: "d2",
  earlyDeparture: "NONE",
  hasAccommodation: false,
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", // UUID v4
  centerId: "c1",
  email: "jan@example.cz",
  gdprConsent: true,
  participants: [{ fullName: "Jan Novák", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", mealType: "MEAT", mealIds: [] }],
};

describe("registrationSubmitSchema", () => {
  it("accepts a valid payload", () => {
    expect(registrationSubmitSchema.safeParse(validSubmit).success).toBe(true);
  });

  it("rejects gdprConsent = false (literal true required)", () => {
    expect(registrationSubmitSchema.safeParse({ ...validSubmit, gdprConsent: false }).success).toBe(false);
  });

  it("rejects more than 10 participants", () => {
    const participants = Array.from({ length: 11 }, () => ({
      fullName: "Ab",
      ageCategory: "AGE_15_PLUS",
      pricingType: "STANDARD",
      mealType: "MEAT",
      mealIds: [],
    }));
    expect(registrationSubmitSchema.safeParse({ ...validSubmit, participants }).success).toBe(false);
  });

  it("rejects zero participants (min 1)", () => {
    expect(registrationSubmitSchema.safeParse({ ...validSubmit, participants: [] }).success).toBe(false);
  });

  it("rejects a non-empty honeypot", () => {
    expect(registrationSubmitSchema.safeParse({ ...validSubmit, honeypot: "i am a bot" }).success).toBe(false);
  });

  it("rejects pricingType on a child (only AGE_15_PLUS may carry it)", () => {
    const payload = {
      ...validSubmit,
      participants: [{ fullName: "Dítě", ageCategory: "AGE_4_7", pricingType: "STANDARD", mealType: "MEAT", mealIds: [] }],
    };
    expect(registrationSubmitSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a participant without a meal type (must choose one)", () => {
    const payload = {
      ...validSubmit,
      participants: [{ fullName: "Jan Novák", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", mealIds: [] }],
    };
    expect(registrationSubmitSchema.safeParse(payload).success).toBe(false);
  });

  it("accepts VEGETARIAN as a meal type", () => {
    const payload = {
      ...validSubmit,
      participants: [{ fullName: "Jan Novák", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", mealType: "VEGETARIAN", mealIds: [] }],
    };
    expect(registrationSubmitSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(registrationSubmitSchema.safeParse({ ...validSubmit, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects a non-UUID idempotencyKey", () => {
    expect(registrationSubmitSchema.safeParse({ ...validSubmit, idempotencyKey: "abc" }).success).toBe(false);
  });
});

describe("calculatePriceSchema", () => {
  it("accepts a valid price-calc payload (no idempotencyKey / email needed)", () => {
    const payload = {
      eventId: "evt1",
      arrivalDateId: "d1",
      arrivalTime: "MORNING",
      departureDateId: "d2",
      earlyDeparture: "NONE",
      hasAccommodation: false,
      participants: [{ ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", mealIds: [] }],
    };
    expect(calculatePriceSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects more than 10 participants", () => {
    const payload = {
      eventId: "evt1",
      arrivalDateId: "d1",
      arrivalTime: "MORNING",
      departureDateId: "d2",
      earlyDeparture: "NONE",
      hasAccommodation: false,
      participants: Array.from({ length: 11 }, () => ({ ageCategory: "AGE_15_PLUS", mealIds: [] })),
    };
    expect(calculatePriceSchema.safeParse(payload).success).toBe(false);
  });
});
