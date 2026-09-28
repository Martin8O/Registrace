import { describe, it, expect } from "vitest";
import {
  registrationSubmitSchema,
  calculatePriceSchema,
  registrationFullUpdateSchema,
  registrationFullPreviewSchema,
} from "./registrations";

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

  // Inverted in M37: the tier used to be a 15+-only concept and a child carrying
  // one was a validation error. Events can now price a supported child differently
  // from a standard one, so every age accepts every tier.
  it("accepts pricingType on a child (the tier applies at every age)", () => {
    for (const pricingType of ["STANDARD", "SUPPORTED", "SURPLUS"]) {
      const payload = {
        ...validSubmit,
        participants: [{ fullName: "Dítě", ageCategory: "AGE_4_7", pricingType, mealType: "MEAT", mealIds: [] }],
      };
      expect(registrationSubmitSchema.safeParse(payload).success).toBe(true);
    }
  });

  it("still rejects a pricingType outside the enum", () => {
    const payload = {
      ...validSubmit,
      participants: [{ fullName: "Dítě", ageCategory: "AGE_4_7", pricingType: "FREE", mealType: "MEAT", mealIds: [] }],
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

  // M40 — the meal tier is a SECOND, independent choice. This layer is
  // event-agnostic on purpose: whether a given event offers a tier is checked in
  // the submit service, the only layer that has the event loaded.
  it("accepts a meal tier different from the participation tier", () => {
    const payload = {
      ...validSubmit,
      participants: [{ fullName: "Jan Novák", ageCategory: "AGE_15_PLUS", pricingType: "SURPLUS", mealPricingType: "SUPPORTED", mealType: "MEAT", mealIds: [] }],
    };
    expect(registrationSubmitSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts a payload with no meal tier at all (a client written before M40)", () => {
    expect(registrationSubmitSchema.safeParse(validSubmit).success).toBe(true);
  });

  it("rejects a meal tier outside the enum", () => {
    const payload = {
      ...validSubmit,
      participants: [{ fullName: "Jan Novák", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", mealPricingType: "FREE", mealType: "MEAT", mealIds: [] }],
    };
    expect(registrationSubmitSchema.safeParse(payload).success).toBe(false);
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

// ─── Admin full edit (M50) ────────────────────────────────────────────────────

const fullPerson = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  fullName: "Jan Novák",
  ageCategory: "AGE_15_PLUS",
  pricingType: "STANDARD",
  mealPricingType: "SUPPORTED",
  mealType: "MEAT",
  mealIds: ["m1", "m2"],
  ...over,
});
const fullEdit = (over: Record<string, unknown> = {}) => ({
  expectedUpdatedAt: "2026-09-20T10:00:00.000Z",
  status: "PAID",
  centerId: "c1",
  hasAccommodation: true,
  arrivalDateId: "d1",
  arrivalTime: "AFTERNOON",
  departureDateId: "d3",
  earlyDeparture: "NONE",
  participants: [fullPerson(), fullPerson({ id: undefined, fullName: "Nový host", mealIds: [] })],
  ...over,
});

describe("registrationFullUpdateSchema", () => {
  it("accepts a full edit with an existing and an added person", () => {
    expect(registrationFullUpdateSchema.safeParse(fullEdit()).success).toBe(true);
  });

  it("has no e-mail field — an e-mail in the body is dropped, never passed on", () => {
    const parsed = registrationFullUpdateSchema.parse(fullEdit({ email: "new@example.cz" }));
    expect(parsed).not.toHaveProperty("email");
  });

  it("requires the updatedAt the editor loaded, as a timestamp", () => {
    expect(registrationFullUpdateSchema.safeParse(fullEdit({ expectedUpdatedAt: undefined })).success).toBe(false);
    expect(registrationFullUpdateSchema.safeParse(fullEdit({ expectedUpdatedAt: "yesterday" })).success).toBe(false);
  });

  it("refuses zero people (that is a cancellation) and more than 10", () => {
    expect(registrationFullUpdateSchema.safeParse(fullEdit({ participants: [] })).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => fullPerson({ id: `p${i}` }));
    expect(registrationFullUpdateSchema.safeParse(fullEdit({ participants: eleven })).success).toBe(false);
  });

  it("requires BOTH tiers on every person — never defaulted", () => {
    expect(registrationFullUpdateSchema.safeParse(fullEdit({ participants: [fullPerson({ mealPricingType: undefined })] })).success).toBe(false);
    expect(registrationFullUpdateSchema.safeParse(fullEdit({ participants: [fullPerson({ pricingType: undefined })] })).success).toBe(false);
  });

  it("refuses the same person twice, with the path of the duplicate", () => {
    const res = registrationFullUpdateSchema.safeParse(fullEdit({ participants: [fullPerson(), fullPerson()] }));
    expect(res.success).toBe(false);
    expect(res.error!.issues.map((i) => i.path)).toEqual([["participants", 1, "id"]]);
  });

  it("refuses the same meal twice on one person, but allows two people the same meal", () => {
    const twice = registrationFullUpdateSchema.safeParse(fullEdit({ participants: [fullPerson({ mealIds: ["m1", "m1"] })] }));
    expect(twice.success).toBe(false);
    expect(twice.error!.issues.map((i) => i.path)).toEqual([["participants", 0, "mealIds"]]);
    const shared = fullEdit({ participants: [fullPerson({ mealIds: ["m1"] }), fullPerson({ id: "p2", mealIds: ["m1"] })] });
    expect(registrationFullUpdateSchema.safeParse(shared).success).toBe(true);
  });

  it("keeps the public name rules (2–100 characters)", () => {
    expect(registrationFullUpdateSchema.safeParse(fullEdit({ participants: [fullPerson({ fullName: "J" })] })).success).toBe(false);
  });
});

describe("registrationFullPreviewSchema", () => {
  it("is the same state without the updatedAt", () => {
    const state: Record<string, unknown> = fullEdit();
    delete state.expectedUpdatedAt;
    expect(registrationFullPreviewSchema.safeParse(state).success).toBe(true);
    expect(registrationFullPreviewSchema.safeParse({ ...state, participants: [fullPerson(), fullPerson()] }).success).toBe(false);
  });
});
