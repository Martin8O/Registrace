import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdminContext } from "@/modules/auth";
import type { RegistrationUpdateInput } from "@/lib/validation";

// ─── Mock the I/O boundary, keep the real pricing engine ──────────────────────
// Same pattern as submit.test.ts: Prisma is mocked (no test DB exists — Supabase
// is the only instance), while modules/pricing runs FOR REAL, so the numbers
// asserted below are the arithmetic the production engine actually performs.

const h = vi.hoisted(() => {
  const tx = {
    registration: { update: vi.fn() },
    participant: { update: vi.fn() },
    participantMeal: { update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const prisma = {
    registration: { findFirst: vi.fn(), update: vi.fn() },
    center: { findFirst: vi.fn() },
    participant: { update: vi.fn() },
    participantMeal: { update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, tx, logAuditEvent: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/audit", () => ({ logAuditEvent: h.logAuditEvent }));
vi.mock("@/lib/email", () => ({ sendRegistrationConfirmation: vi.fn() }));
vi.mock("@/modules/events", () => ({ isPubliclyVisible: () => true }));

import {
  updateRegistration,
  RegistrationParticipantMismatchError,
  RegistrationPricingTypeUnavailableError,
} from "./index";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// A 3-day event. Stay = day 1 (morning arrival) → day 3, no early departure, so
// participationDays = 3 and nights = 2.
//
//   adult 15+  : 100/day, 50/night  → 300 without accommodation, 400 with
//   child 8–14 :  40/day, 20/night  → 120 without accommodation, 160 with
//
// The child's night rate is deliberately non-zero: pricing is data-driven and no
// age is special-cased (invariant 15), so a child must be re-priced too.

const NO_DISCOUNTS = {
  morningArrivalDiscount: 0,
  afternoonArrivalDiscount: 0,
  eveningArrivalDiscount: 0,
  earlyDepartureDiscount: 0,
};

const EVENT_DATES = [
  { id: "d1", date: new Date("2026-05-01T00:00:00.000Z"), sortOrder: 1 },
  { id: "d2", date: new Date("2026-05-02T00:00:00.000Z"), sortOrder: 2 },
  { id: "d3", date: new Date("2026-05-03T00:00:00.000Z"), sortOrder: 3 },
];

const PRICING_RULES = [
  { ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", dailyRate: 100, nightRate: 50, ...NO_DISCOUNTS },
  // The adult's supported stay — deliberately a different rate from the standard
  // one above, so a participation-tier edit either moves the number or fails.
  { ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", dailyRate: 60, nightRate: 30, ...NO_DISCOUNTS },
  { ageCategory: "AGE_8_14", pricingType: "STANDARD", dailyRate: 40, nightRate: 20, ...NO_DISCOUNTS },
];

// The flat EventMeal.price is deliberately absurd — if any of these assertions
// ever matches 999 the engine fell back to the legacy column instead of the
// per-age price list (invariant 21).
const MEALS = [{ id: "m_b", eventDateId: "d1", mealType: "BREAKFAST", price: 999, isClosed: false }];

const MEAL_PRICING_RULES = [
  { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", price: 80 },
  { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", price: 55 },
  { mealType: "BREAKFAST", ageCategory: "AGE_8_14", pricingType: "STANDARD", price: 40 },
];

// The adult eats on the SUPPORTED tier while staying on the STANDARD one — the two
// tiers are independent since M40. This is not decoration: if the re-price ever
// stopped passing the stored meal tier through, the engine would resolve the
// STANDARD breakfast (80) instead of the supported one (55) and the "meal prices
// never move" assertions below would fail. With every participant on STANDARD, as
// the fixture was until M40a, dropping the tier changed nothing and those
// assertions could not catch it.
const ADULT = {
  id: "p1",
  ageCategory: "AGE_15_PLUS",
  pricingType: "STANDARD",
  mealPricingType: "SUPPORTED",
  // The join row's own id: a meal-tier edit re-prices this snapshot in place.
  meals: [{ id: "pm1", eventMealId: "m_b" }],
};
const CHILD = {
  id: "p2",
  ageCategory: "AGE_8_14",
  pricingType: "STANDARD",
  mealPricingType: "STANDARD",
  meals: [{ id: "pm2", eventMealId: "m_b" }],
};

// Both tier sets, all three each — the column default every event carries (M40).
const ALL_TIERS = ["STANDARD", "SUPPORTED", "SURPLUS"];

// The tier payload the admin editor sends: every participant, always, with the
// tiers exactly as stored unless the admin moved one.
const tiersAsStored = (participants = [ADULT, CHILD]) =>
  participants.map((p) => ({
    id: p.id,
    pricingType: p.pricingType as "STANDARD" | "SUPPORTED" | "SURPLUS",
    mealPricingType: p.mealPricingType as "STANDARD" | "SUPPORTED" | "SURPLUS",
  }));

const ADULT_MEAL = 55; // 15+ / SUPPORTED breakfast — deliberately not the 80 above
const CHILD_MEAL = 40;
const TOTAL_WITHOUT = 300 + ADULT_MEAL + 120 + CHILD_MEAL; // 515
const TOTAL_WITH = 400 + ADULT_MEAL + 160 + CHILD_MEAL; // 655
const NIGHTS_DELTA = TOTAL_WITH - TOTAL_WITHOUT; // 140 = (50 + 20) × 2 nights

const CTX = {
  userId: "admin-1",
  role: "SUPER_ADMIN",
  centerIds: [],
  ip: null,
} as unknown as AdminContext;

const input = (over: Partial<RegistrationUpdateInput> = {}): RegistrationUpdateInput =>
  ({
    centerId: "c1",
    hasAccommodation: true,
    status: "REGISTERED",
    ...over,
  }) as RegistrationUpdateInput;

function storedForRepricing(participants = [ADULT, CHILD]) {
  return {
    arrivalDateId: "d1",
    arrivalTime: "MORNING",
    departureDateId: "d3",
    earlyDeparture: "NONE",
    event: {
      dates: EVENT_DATES,
      meals: MEALS,
      pricingRules: PRICING_RULES,
      mealPricingRules: MEAL_PRICING_RULES,
    },
    participants,
  };
}

// `before` = the pre-image assertRegistrationWritable returns; the second
// findFirst is the repricing load (only issued when accommodation changed).
function setup(
  before: {
    hasAccommodation: boolean;
    status?: string;
    totalPrice?: number;
    participationPricingTypes?: string[];
    mealPricingTypes?: string[];
  },
  participants = [ADULT, CHILD],
) {
  h.prisma.registration.findFirst
    .mockResolvedValueOnce({
      centerId: "c1",
      status: before.status ?? "REGISTERED",
      totalPrice: before.totalPrice ?? TOTAL_WITHOUT,
      hasAccommodation: before.hasAccommodation,
      event: {
        centerId: "evt-center",
        participationPricingTypes: before.participationPricingTypes ?? ALL_TIERS,
        mealPricingTypes: before.mealPricingTypes ?? ALL_TIERS,
      },
      // The stored tiers ride on the pre-image query, so "did anything move?" is
      // answerable without a second round trip.
      participants: participants.map((p) => ({
        id: p.id,
        pricingType: p.pricingType,
        mealPricingType: p.mealPricingType,
      })),
    })
    .mockResolvedValueOnce(storedForRepricing(participants));
  h.prisma.center.findFirst.mockResolvedValue({ id: "c1" });
}

const regUpdateData = () => h.tx.registration.update.mock.calls[0]?.[0]?.data;
const participantWrites = () =>
  h.tx.participant.update.mock.calls.map((c) => ({
    id: c[0].where.id,
    ...c[0].data,
  }));

// resetAllMocks, not clearAllMocks: a test that changes nothing consumes only the
// FIRST queued findFirst, and clearAllMocks leaves the unused mockResolvedValueOnce
// in the queue — every later test would then read the previous test's payload.
function reset() {
  vi.resetAllMocks();
  h.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(h.tx));
}

beforeEach(reset);

describe("updateRegistration — accommodation re-pricing (M39)", () => {
  it("off → on raises the total by nightRate × (days − 1) for every participant", async () => {
    setup({ hasAccommodation: false, totalPrice: TOTAL_WITHOUT });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    expect(regUpdateData().totalPrice).toBe(TOTAL_WITH);
    expect(TOTAL_WITH - TOTAL_WITHOUT).toBe(NIGHTS_DELTA);
  });

  it("on → off lowers the total by the same amount", async () => {
    setup({ hasAccommodation: true, totalPrice: TOTAL_WITH });

    await updateRegistration("r1", input({ hasAccommodation: false }), CTX);

    expect(regUpdateData().totalPrice).toBe(TOTAL_WITHOUT);
  });

  it("leaves every stored meal price untouched in both directions", async () => {
    setup({ hasAccommodation: false });
    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);
    expect(participantWrites().map((p) => p.mealPrice)).toEqual([ADULT_MEAL, CHILD_MEAL]);

    reset();
    setup({ hasAccommodation: true, totalPrice: TOTAL_WITH });
    await updateRegistration("r1", input({ hasAccommodation: false }), CTX);
    expect(participantWrites().map((p) => p.mealPrice)).toEqual([ADULT_MEAL, CHILD_MEAL]);
  });

  it("an accommodation flip writes no ParticipantMeal row — it cannot move a meal price", async () => {
    // Accommodation does not enter the meal half of the engine, so the at-submit
    // snapshots stand. (A MEAL-TIER edit does re-price them — see the tier suite
    // below; that is the one thing that legitimately moves these rows.)
    setup({ hasAccommodation: false });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    expect(h.tx.participantMeal.update).not.toHaveBeenCalled();
    expect(h.tx.participantMeal.updateMany).not.toHaveBeenCalled();
    expect(h.tx.participantMeal.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.participantMeal.createMany).not.toHaveBeenCalled();
    expect(h.prisma.participantMeal.updateMany).not.toHaveBeenCalled();
  });

  it("keeps each participant's parts consistent and summing to the registration total", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    const writes = participantWrites();
    for (const p of writes) {
      expect(p.participationPrice + p.mealPrice).toBe(p.totalPrice);
    }
    expect(writes.reduce((s, p) => s + p.totalPrice, 0)).toBe(regUpdateData().totalPrice);
  });

  it("re-prices a child whose rule carries a non-zero night rate (no age is special-cased)", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    const child = participantWrites().find((p) => p.id === "p2");
    expect(child?.participationPrice).toBe(160); // 40 × 3 days + 20 × 2 nights
    expect(child?.mealPrice).toBe(CHILD_MEAL);
  });

  it("writes no price fields and issues no extra query when only centre and status change", async () => {
    setup({ hasAccommodation: false, status: "REGISTERED" });

    await updateRegistration(
      "r1",
      input({ hasAccommodation: false, centerId: "c1", status: "PAID" }),
      CTX,
    );

    expect(h.prisma.registration.findFirst).toHaveBeenCalledTimes(1);
    expect(regUpdateData()).not.toHaveProperty("totalPrice");
    expect(h.tx.participant.update).not.toHaveBeenCalled();
  });

  it("excludes soft-deleted participants and reads the rest in sortOrder", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    const select = h.prisma.registration.findFirst.mock.calls[1]?.[0]?.select;
    expect(select.participants.where).toEqual({ deletedAt: null });
    expect(select.participants.orderBy).toEqual({ sortOrder: "asc" });
  });

  it("prices only the participants the load returned", async () => {
    setup({ hasAccommodation: false }, [ADULT]);

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    expect(participantWrites()).toHaveLength(1);
    expect(regUpdateData().totalPrice).toBe(400 + ADULT_MEAL);
  });

  it("keeps ordered meals and their prices when re-priced after the meal deadline", async () => {
    // The repricing load deliberately never reads mealRegistrationDeadline: the
    // submit path's meal-stripping gate applies to NEW orders only. Re-applying
    // it here would delete the meals of anyone edited after the cut-off.
    setup({ hasAccommodation: false });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    const select = h.prisma.registration.findFirst.mock.calls[1]?.[0]?.select;
    expect(select.event.select).not.toHaveProperty("mealRegistrationDeadline");
    expect(participantWrites().map((p) => p.mealPrice)).toEqual([ADULT_MEAL, CHILD_MEAL]);
  });

  it("records the old and new total in the audit entry", async () => {
    setup({ hasAccommodation: false, totalPrice: TOTAL_WITHOUT });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    const entry = h.logAuditEvent.mock.calls[0]?.[0];
    expect(entry.oldData.totalPrice).toBe(TOTAL_WITHOUT);
    expect(entry.newData.totalPrice).toBe(TOTAL_WITH);
  });

  it("carries the unchanged total into the audit entry when no re-price happened", async () => {
    setup({ hasAccommodation: true, totalPrice: TOTAL_WITH });

    await updateRegistration("r1", input({ hasAccommodation: true, status: "PAID" }), CTX);

    const entry = h.logAuditEvent.mock.calls[0]?.[0];
    expect(entry.action).toBe("registration.status_change");
    expect(entry.oldData.totalPrice).toBe(TOTAL_WITH);
    expect(entry.newData.totalPrice).toBe(TOTAL_WITH);
  });

  it("loads the stored meal tier and keeps a supported participant's meals at their price", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    const select = h.prisma.registration.findFirst.mock.calls[1]?.[0]?.select;
    expect(select.participants.select.mealPricingType).toBe(true);
    expect(participantWrites().find((p) => p.id === "p1")?.mealPrice).toBe(55);
  });

  it("writes the registration and the participants in one transaction", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration("r1", input({ hasAccommodation: true }), CTX);

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.prisma.registration.update).not.toHaveBeenCalled();
    expect(h.prisma.participant.update).not.toHaveBeenCalled();
  });
});
// ─── Editing a participant's two pricing tiers (M40c) ─────────────────────────
// The tiers are the other editable thing that moves money. Both are re-priced
// through the real engine, both are written back onto the participant, and a MEAL
// tier change also re-snapshots every ParticipantMeal.price — otherwise the stored
// per-meal figure would keep stating the old tier's price under a correct total.

describe("updateRegistration — pricing-tier edits", () => {
  const mealWrites = () =>
    h.tx.participantMeal.update.mock.calls.map((c) => ({
      id: c[0].where.id,
      price: c[0].data.price,
    }));

  it("moving the participation tier re-prices the stay through the real engine", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration(
      "r1",
      input({
        hasAccommodation: false,
        participants: [
          { id: "p1", pricingType: "SUPPORTED", mealPricingType: "SUPPORTED" },
          ...tiersAsStored([CHILD]),
        ],
      }),
      CTX,
    );

    const adult = participantWrites().find((p) => p.id === "p1");
    expect(adult?.participationPrice).toBe(180); // 60/day × 3, was 100/day × 3 = 300
    expect(adult?.pricingType).toBe("SUPPORTED");
  });

  it("moving the participation tier leaves the meal price alone (the tiers are independent)", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration(
      "r1",
      input({
        hasAccommodation: false,
        participants: [
          { id: "p1", pricingType: "SUPPORTED", mealPricingType: "SUPPORTED" },
          ...tiersAsStored([CHILD]),
        ],
      }),
      CTX,
    );

    const adult = participantWrites().find((p) => p.id === "p1");
    expect(adult?.mealPrice).toBe(ADULT_MEAL); // still the SUPPORTED breakfast, 55
    expect(adult?.mealPricingType).toBe("SUPPORTED");
    expect(mealWrites()).toEqual([]);
  });

  it("moving the meal tier re-prices the meals AND re-snapshots every ordered one", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration(
      "r1",
      input({
        hasAccommodation: false,
        participants: [
          { id: "p1", pricingType: "STANDARD", mealPricingType: "STANDARD" },
          ...tiersAsStored([CHILD]),
        ],
      }),
      CTX,
    );

    const adult = participantWrites().find((p) => p.id === "p1");
    expect(adult?.mealPrice).toBe(80); // 15+ STANDARD breakfast, up from SUPPORTED 55
    expect(adult?.participationPrice).toBe(300); // stay untouched
    // The stored per-meal snapshot follows the new tier — 80, never the absurd
    // flat EventMeal.price of 999 (that would mean the legacy fallback fired).
    expect(mealWrites()).toEqual([{ id: "pm1", price: 80 }]);
  });

  it("writes both tiers in the same update as the prices they produced", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration(
      "r1",
      input({
        hasAccommodation: false,
        participants: [
          { id: "p1", pricingType: "SUPPORTED", mealPricingType: "STANDARD" },
          ...tiersAsStored([CHILD]),
        ],
      }),
      CTX,
    );

    expect(participantWrites().find((p) => p.id === "p1")).toMatchObject({
      pricingType: "SUPPORTED",
      mealPricingType: "STANDARD",
      participationPrice: 180,
      mealPrice: 80,
      totalPrice: 260,
    });
  });

  it("sending every tier UNCHANGED re-prices nothing and issues no extra query", async () => {
    // The editor always posts the full tier list, so this is the ordinary save.
    setup({ hasAccommodation: false, status: "REGISTERED" });

    await updateRegistration(
      "r1",
      input({ hasAccommodation: false, status: "PAID", participants: tiersAsStored() }),
      CTX,
    );

    expect(h.prisma.registration.findFirst).toHaveBeenCalledTimes(1);
    expect(regUpdateData()).not.toHaveProperty("totalPrice");
    expect(h.tx.participant.update).not.toHaveBeenCalled();
    expect(mealWrites()).toEqual([]);
  });

  it("refuses a tier the event does not offer, writing nothing", async () => {
    setup({ hasAccommodation: false, mealPricingTypes: ["STANDARD"] });

    await expect(
      updateRegistration(
        "r1",
        input({
          hasAccommodation: false,
          participants: [
            { id: "p1", pricingType: "STANDARD", mealPricingType: "SURPLUS" },
            ...tiersAsStored([CHILD]),
          ],
        }),
        CTX,
      ),
    ).rejects.toBeInstanceOf(RegistrationPricingTypeUnavailableError);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a participant that is not on this registration, writing nothing", async () => {
    setup({ hasAccommodation: false });

    await expect(
      updateRegistration(
        "r1",
        input({
          hasAccommodation: false,
          participants: [{ id: "someone-elses", pricingType: "SURPLUS", mealPricingType: "SURPLUS" }],
        }),
        CTX,
      ),
    ).rejects.toBeInstanceOf(RegistrationParticipantMismatchError);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("re-prices a CHILD's tier too — no age is special-cased", async () => {
    setup({ hasAccommodation: false });

    await updateRegistration(
      "r1",
      input({
        hasAccommodation: false,
        participants: [
          ...tiersAsStored([ADULT]),
          { id: "p2", pricingType: "STANDARD", mealPricingType: "SUPPORTED" },
        ],
      }),
      CTX,
    );

    const child = participantWrites().find((p) => p.id === "p2");
    expect(child?.mealPricingType).toBe("SUPPORTED");
    // 8–14 has no SUPPORTED breakfast row, and the list EXISTS — so it resolves to
    // 0, never to the flat 999 (invariant 21). A visible 0 beats a silent full charge.
    expect(child?.mealPrice).toBe(0);
    expect(mealWrites()).toEqual([{ id: "pm2", price: 0 }]);
  });
});
