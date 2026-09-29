import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdminContext } from "@/modules/auth";
import type { RegistrationFullUpdateInput } from "@/lib/validation";

// ─── The admin FULL edit (M50) ────────────────────────────────────────────────
// Prisma mocked (no test DB exists — Supabase is the only instance),
// the pricing engine REAL — every number asserted below is arithmetic the
// production engine performs.

const h = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    registration: { updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    participant: { update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    participantMeal: { updateMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const prisma = {
    registration: { findFirst: vi.fn(), findMany: vi.fn() },
    center: { findFirst: vi.fn() },
    event: { findFirst: vi.fn() },
    eventDate: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, tx, logAuditEvent: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/audit", () => ({ logAuditEvent: h.logAuditEvent }));
vi.mock("@/lib/email", () => ({ sendRegistrationConfirmation: vi.fn() }));
vi.mock("@/modules/events", () => ({ isPubliclyVisible: () => true }));

import {
  applyFullUpdate,
  previewFullUpdate,
  listRegistrations,
  getEventAccommodationStats,
  RegistrationCapacityError,
  RegistrationCenterInvalidError,
  RegistrationChangedError,
  RegistrationForbiddenError,
  RegistrationMealInvalidError,
  RegistrationNotFoundError,
  RegistrationParticipantMismatchError,
  RegistrationPricingTypeUnavailableError,
  RegistrationStayInvalidError,
} from "./index";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// A 3-day event, breakfast/lunch/dinner each day; day 2's dinner is CLOSED.
//
//   15+ STANDARD stay : 100/day, 50/night; afternoon arrival −20, early departure −30
//   15+ SUPPORTED stay:  60/day, 30/night; afternoon arrival −10, early departure −15
//   8–14 STANDARD stay:  40/day, 20/night; no discounts
//
//   meals (flat EventMeal.price = 999, deliberately absurd — matching it would
//   mean the engine fell back to the legacy column, invariant 21):
//     15+ STANDARD  B 80 · L 120 · D 100
//     15+ SUPPORTED B 55 · L  90 · D  70
//     8–14 STANDARD B 40 · L  60 · D  50

const rule = (ageCategory: string, pricingType: string, dailyRate: number, nightRate: number, afternoon = 0, early = 0) => ({
  ageCategory, pricingType, dailyRate, nightRate,
  morningArrivalDiscount: 0, afternoonArrivalDiscount: afternoon, eveningArrivalDiscount: 0, earlyDepartureDiscount: early,
});
const PRICING_RULES = [
  rule("AGE_15_PLUS", "STANDARD", 100, 50, 20, 30),
  rule("AGE_15_PLUS", "SUPPORTED", 60, 30, 10, 15),
  rule("AGE_8_14", "STANDARD", 40, 20),
];
const mealRule = (mealType: string, ageCategory: string, pricingType: string, price: number) => ({ mealType, ageCategory, pricingType, price });
const MEAL_PRICING_RULES = [
  mealRule("BREAKFAST", "AGE_15_PLUS", "STANDARD", 80), mealRule("LUNCH", "AGE_15_PLUS", "STANDARD", 120), mealRule("DINNER", "AGE_15_PLUS", "STANDARD", 100),
  mealRule("BREAKFAST", "AGE_15_PLUS", "SUPPORTED", 55), mealRule("LUNCH", "AGE_15_PLUS", "SUPPORTED", 90), mealRule("DINNER", "AGE_15_PLUS", "SUPPORTED", 70),
  mealRule("BREAKFAST", "AGE_8_14", "STANDARD", 40), mealRule("LUNCH", "AGE_8_14", "STANDARD", 60), mealRule("DINNER", "AGE_8_14", "STANDARD", 50),
];
const DATES = [1, 2, 3].map((n) => ({
  id: `d${n}`, date: new Date(`2026-05-0${n}T00:00:00.000Z`), sortOrder: n, label_cs: `Den ${n}`, label_en: `Day ${n}`,
}));
const MEALS = DATES.flatMap((d, i) =>
  (["BREAKFAST", "LUNCH", "DINNER"] as const).map((mealType) => ({
    id: `${mealType[0]!.toLowerCase()}${i + 1}`, // b1 l1 d1 … d3
    eventDateId: d.id, mealType, price: 999,
    isClosed: d.id === "d2" && mealType === "DINNER",
  })),
);
const ALL_TIERS = ["STANDARD", "SUPPORTED", "SURPLUS"];
const UPDATED_AT = "2026-09-20T10:00:00.000Z";

// Stored: day 1 morning → day 3, no accommodation.
//   Adult: STANDARD stay (300) + SUPPORTED meals b1 55 + l1 90 = 145 → 445
//   Child: STANDARD stay (120) + l1 60                            →  180
//   Total 625. The adult is the M40 pin: stays STANDARD, eats SUPPORTED — any
//   path that dropped the meal tier would price breakfast at 80, not 55.
const ADULT = {
  id: "p1", fullName: "Dospělý", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", mealPricingType: "SUPPORTED",
  mealType: "MEAT", participationPrice: 300, mealPrice: 145, totalPrice: 445, sortOrder: 0,
  meals: [{ id: "pm1", eventMealId: "b1", price: 55 }, { id: "pm2", eventMealId: "l1", price: 90 }],
};
const CHILD = {
  id: "p2", fullName: "Dítě", ageCategory: "AGE_8_14", pricingType: "STANDARD", mealPricingType: "STANDARD",
  mealType: "VEGETARIAN", participationPrice: 120, mealPrice: 60, totalPrice: 180, sortOrder: 1,
  meals: [{ id: "pm3", eventMealId: "l1", price: 60 }],
};

type StoredOverrides = Partial<{
  status: string; centerId: string; arrivalDateId: string; departureDateId: string;
  eventCenterId: string; maxRegistrations: number | null; mealRegistrationDeadline: Date | null;
  participationPricingTypes: string[]; mealPricingTypes: string[];
  participants: typeof ADULT[];
}>;

function stored(o: StoredOverrides = {}) {
  return {
    id: "r1",
    status: o.status ?? "REGISTERED",
    centerId: o.centerId ?? "c1",
    hasAccommodation: false,
    arrivalDateId: o.arrivalDateId ?? "d1",
    arrivalTime: "MORNING",
    departureDateId: o.departureDateId ?? "d3",
    earlyDeparture: "NONE",
    totalPrice: 625,
    event: {
      id: "evt1",
      centerId: o.eventCenterId ?? "evt-center",
      maxRegistrations: o.maxRegistrations ?? null,
      mealRegistrationDeadline: o.mealRegistrationDeadline ?? null,
      participationPricingTypes: o.participationPricingTypes ?? ALL_TIERS,
      mealPricingTypes: o.mealPricingTypes ?? ALL_TIERS,
      dates: DATES,
      meals: MEALS,
      pricingRules: PRICING_RULES,
      mealPricingRules: MEAL_PRICING_RULES,
    },
    participants: o.participants ?? [ADULT, CHILD],
  };
}

// The editor's payload for a participant exactly as stored.
const asInput = (p: typeof ADULT) => ({
  id: p.id, fullName: p.fullName,
  ageCategory: p.ageCategory as "AGE_15_PLUS",
  pricingType: p.pricingType as "STANDARD",
  mealPricingType: p.mealPricingType as "STANDARD",
  mealType: p.mealType as "MEAT",
  mealIds: p.meals.map((m) => m.eventMealId),
});

function input(over: Partial<RegistrationFullUpdateInput> = {}): RegistrationFullUpdateInput {
  return {
    expectedUpdatedAt: UPDATED_AT,
    status: "REGISTERED",
    centerId: "c1",
    hasAccommodation: false,
    arrivalDateId: "d1",
    arrivalTime: "MORNING",
    departureDateId: "d3",
    earlyDeparture: "NONE",
    participants: [asInput(ADULT), asInput(CHILD)],
    ...over,
  } as RegistrationFullUpdateInput;
}

const SUPER = { userId: "admin-1", role: "SUPER_ADMIN", centerIds: [], ip: null } as unknown as AdminContext;
const adminOf = (...centerIds: string[]) =>
  ({ userId: "admin-2", role: "ADMIN", centerIds, ip: null }) as unknown as AdminContext;

const regWrite = () => h.tx.registration.updateMany.mock.calls[0]?.[0];
const participantUpdates = () => h.tx.participant.update.mock.calls.map((c) => ({ id: c[0].where.id, ...c[0].data }));
const nothingWritten = () => {
  expect(h.prisma.$transaction).not.toHaveBeenCalled();
  expect(h.logAuditEvent).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  h.prisma.registration.findFirst.mockResolvedValue(stored());
  h.prisma.center.findFirst.mockResolvedValue({ id: "c2" });
  h.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(h.tx));
  h.tx.registration.updateMany.mockResolvedValue({ count: 1 });
  h.tx.registration.count.mockResolvedValue(0);
  h.tx.participant.create.mockResolvedValue({ id: "p-new" });
});

// ─── The no-op edit ───────────────────────────────────────────────────────────

describe("applyFullUpdate — saving what is stored", () => {
  it("reproduces the stored price and writes no participant or meal row", async () => {
    const res = await applyFullUpdate("r1", input(), SUPER);

    expect(res).toEqual({ id: "r1", totalPrice: 625, updatedAt: expect.any(String) });
    expect(regWrite().data.totalPrice).toBe(625);
    expect(h.tx.participant.update).not.toHaveBeenCalled();
    expect(h.tx.participant.create).not.toHaveBeenCalled();
    expect(h.tx.participant.updateMany).not.toHaveBeenCalled();
    expect(h.tx.participantMeal.deleteMany).not.toHaveBeenCalled();
    expect(h.tx.participantMeal.createMany).not.toHaveBeenCalled();
    expect(h.tx.participantMeal.updateMany).not.toHaveBeenCalled();
  });

  it("never writes the number, the idempotency key, the e-mail, the locale or the confirmation time", async () => {
    await applyFullUpdate("r1", input(), SUPER);
    const keys = Object.keys(regWrite().data);
    for (const forbidden of ["registrationNumber", "idempotencyKey", "email", "locale", "confirmationSentAt", "gdprConsent"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("is guarded by the updatedAt the editor loaded, inside one transaction with an explicit timeout", async () => {
    await applyFullUpdate("r1", input(), SUPER);
    expect(regWrite().where).toEqual({ id: "r1", deletedAt: null, updatedAt: new Date(UPDATED_AT) });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.prisma.$transaction.mock.calls[0]![1]).toMatchObject({ timeout: expect.any(Number) });
  });
});

// ─── People ───────────────────────────────────────────────────────────────────

describe("applyFullUpdate — removing and adding people", () => {
  it("a family member who did not come: soft-deleted, the total drops by exactly their price", async () => {
    const res = await applyFullUpdate("r1", input({ participants: [asInput(ADULT)] }), SUPER);

    expect(res.totalPrice).toBe(445);
    expect(h.tx.participant.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p2"] }, registrationId: "r1" },
      data: { deletedAt: expect.any(Date) },
    });
    // Their meal rows stay for the audit trail — every reader filters the person.
    expect(h.tx.participantMeal.deleteMany).not.toHaveBeenCalled();
    // The adult's row did not move, so it is not rewritten.
    expect(h.tx.participant.update).not.toHaveBeenCalled();
  });

  it("an added person is created after the last one, with meals priced at their own meal tier", async () => {
    const newcomer = {
      fullName: "Host", ageCategory: "AGE_15_PLUS" as const, pricingType: "SUPPORTED" as const,
      mealPricingType: "STANDARD" as const, mealType: "VEGETARIAN" as const, mealIds: ["l2", "b3"],
    };
    const res = await applyFullUpdate("r1", input({ participants: [asInput(ADULT), asInput(CHILD), newcomer] }), SUPER);

    // SUPPORTED stay 60 × 3 = 180; STANDARD meals l2 120 + b3 80 = 200 → 380.
    expect(res.totalPrice).toBe(625 + 380);
    expect(h.tx.participant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        registrationId: "r1", sortOrder: 2, fullName: "Host",
        pricingType: "SUPPORTED", mealPricingType: "STANDARD",
        participationPrice: 180, mealPrice: 200, totalPrice: 380,
      }),
      select: { id: true },
    });
    expect(h.tx.participantMeal.createMany).toHaveBeenCalledWith({
      data: [
        { participantId: "p-new", eventMealId: "l2", price: 120 },
        { participantId: "p-new", eventMealId: "b3", price: 80 },
      ],
    });
  });

  it("refuses an id that is not a live participant of this registration, writing nothing", async () => {
    await expect(
      applyFullUpdate("r1", input({ participants: [{ ...asInput(ADULT), id: "someone-else" }] }), SUPER),
    ).rejects.toBeInstanceOf(RegistrationParticipantMismatchError);
    nothingWritten();
  });
});

// ─── Meals ────────────────────────────────────────────────────────────────────

describe("applyFullUpdate — meals", () => {
  it("swapping a meal deletes the old row, creates the new one at the MEAL tier's price", async () => {
    // Adult: lunch day 1 → dinner day 1. SUPPORTED dinner = 70 (not STANDARD 100).
    const res = await applyFullUpdate(
      "r1",
      input({ participants: [{ ...asInput(ADULT), mealIds: ["b1", "d1"] }, asInput(CHILD)] }),
      SUPER,
    );

    expect(res.totalPrice).toBe(625 - 90 + 70);
    expect(h.tx.participantMeal.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["pm2"] } } });
    expect(h.tx.participantMeal.createMany).toHaveBeenCalledWith({
      data: [{ participantId: "p1", eventMealId: "d1", price: 70 }],
    });
    expect(participantUpdates()).toEqual([
      expect.objectContaining({ id: "p1", mealPrice: 125, totalPrice: 425, mealPricingType: "SUPPORTED", pricingType: "STANDARD" }),
    ]);
  });

  it("moving only the meal tier re-prices every kept meal row in place (one statement per price)", async () => {
    // Adult SUPPORTED → STANDARD meals: b1 55 → 80, l1 90 → 120; the stay stays STANDARD.
    const res = await applyFullUpdate(
      "r1",
      input({ participants: [{ ...asInput(ADULT), mealPricingType: "STANDARD" }, asInput(CHILD)] }),
      SUPER,
    );

    expect(res.totalPrice).toBe(625 + 25 + 30);
    const reprices = h.tx.participantMeal.updateMany.mock.calls.map((c) => [c[0].data.price, c[0].where.id.in]);
    expect(reprices).toEqual(expect.arrayContaining([[80, ["pm1"]], [120, ["pm2"]]]));
    expect(reprices).toHaveLength(2);
    expect(participantUpdates()[0]).toMatchObject({ pricingType: "STANDARD", mealPricingType: "STANDARD", participationPrice: 300 });
  });

  it("moving only the stay tier leaves every meal price alone (the tiers are independent)", async () => {
    // Adult STANDARD → SUPPORTED stay: 300 → 180; meals stay at SUPPORTED 145.
    const res = await applyFullUpdate(
      "r1",
      input({ participants: [{ ...asInput(ADULT), pricingType: "SUPPORTED" }, asInput(CHILD)] }),
      SUPER,
    );
    expect(res.totalPrice).toBe(625 - 120);
    expect(h.tx.participantMeal.updateMany).not.toHaveBeenCalled();
    expect(participantUpdates()[0]).toMatchObject({ pricingType: "SUPPORTED", mealPricingType: "SUPPORTED", mealPrice: 145 });
  });

  it("refuses a meal the event closed for that day, naming the person and the meal", async () => {
    await expect(
      applyFullUpdate("r1", input({ participants: [asInput(ADULT), { ...asInput(CHILD), mealIds: ["d2"] }] }), SUPER),
    ).rejects.toMatchObject({ code: "meal_closed", participantIndex: 1, mealId: "d2" });
    nothingWritten();
  });

  it("refuses a meal that is not this event's", async () => {
    await expect(
      applyFullUpdate("r1", input({ participants: [{ ...asInput(ADULT), mealIds: ["ghost"] }, asInput(CHILD)] }), SUPER),
    ).rejects.toMatchObject({ code: "meal_unknown" });
    nothingWritten();
  });

  it("allows meals after the meal deadline (the team adds them on site)", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored({ mealRegistrationDeadline: new Date("2020-01-01") }));
    const res = await applyFullUpdate(
      "r1",
      input({ participants: [{ ...asInput(ADULT), mealIds: ["b1", "l1", "l2"] }, asInput(CHILD)] }),
      SUPER,
    );
    expect(res.totalPrice).toBe(625 + 90);
  });
});

// ─── The stay ─────────────────────────────────────────────────────────────────

describe("applyFullUpdate — the stay", () => {
  it("arriving a day later while day-1 meals are still ticked → meal_outside_stay, nothing written", async () => {
    await expect(applyFullUpdate("r1", input({ arrivalDateId: "d2" }), SUPER)).rejects.toMatchObject({
      code: "meal_outside_stay",
      participantIndex: 0,
      mealId: "b1",
    });
    nothingWritten();
  });

  it("arriving a day later with the day-1 meals dropped re-prices the stay and the meals", async () => {
    const res = await applyFullUpdate(
      "r1",
      input({
        arrivalDateId: "d2",
        participants: [{ ...asInput(ADULT), mealIds: ["l2"] }, { ...asInput(CHILD), mealIds: [] }],
      }),
      SUPER,
    );
    // Adult 100 × 2 = 200 + SUPPORTED l2 90 = 290; child 40 × 2 = 80.
    expect(res.totalPrice).toBe(370);
    expect(regWrite().data).toMatchObject({ arrivalDateId: "d2", totalPrice: 370 });
    expect(h.tx.participantMeal.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["pm1", "pm2", "pm3"] } } });
  });

  it("afternoon arrival drops the arrival-day breakfast from what may be ticked", async () => {
    await expect(applyFullUpdate("r1", input({ arrivalTime: "AFTERNOON" }), SUPER)).rejects.toMatchObject({
      code: "meal_outside_stay",
    });
  });

  it("early departure after breakfast subtracts the discount per tier", async () => {
    const res = await applyFullUpdate(
      "r1",
      input({ earlyDeparture: "AFTER_BREAKFAST" }),
      SUPER,
    );
    // Adult STANDARD −30; child rule carries no discount.
    expect(res.totalPrice).toBe(625 - 30);
  });

  it("accommodation adds each tier's night rate × nights", async () => {
    const res = await applyFullUpdate("r1", input({ hasAccommodation: true }), SUPER);
    expect(res.totalPrice).toBe(625 + 2 * 50 + 2 * 20);
  });

  it.each([
    // `as const` per row, not on the array: the README test counter reads the
    // literal array to know how many cases this is.
    ["departure before arrival", { arrivalDateId: "d3", departureDateId: "d1" }, "departure_before_arrival"] as const,
    ["same-day evening arrival", { arrivalDateId: "d3", departureDateId: "d3", arrivalTime: "EVENING" }, "same_day_evening_arrival"] as const,
    ["a day of another event", { departureDateId: "elsewhere" }, "day_unknown"] as const,
  ])("refuses %s with its reason", async (_label, stay, reason) => {
    const p = [{ ...asInput(ADULT), mealIds: [] }, { ...asInput(CHILD), mealIds: [] }];
    const err = await applyFullUpdate("r1", input({ ...stay, participants: p }), SUPER).catch((e) => e);
    expect(err).toBeInstanceOf(RegistrationStayInvalidError);
    expect(err.reason).toBe(reason);
    nothingWritten();
  });
});

// ─── Tiers, ages ──────────────────────────────────────────────────────────────

describe("applyFullUpdate — tiers and ages", () => {
  it("refuses moving someone onto a tier the event does not offer", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored({ participationPricingTypes: ["STANDARD"] }));
    await expect(
      applyFullUpdate("r1", input({ participants: [{ ...asInput(ADULT), pricingType: "SUPPORTED" }, asInput(CHILD)] }), SUPER),
    ).rejects.toMatchObject({ name: "RegistrationPricingTypeUnavailableError", participantIndex: 0, half: "stay" });
    nothingWritten();
  });

  it("keeps a stored tier the event no longer offers — a name fix must not fail on it", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored({ mealPricingTypes: ["STANDARD"] }));
    const res = await applyFullUpdate(
      "r1",
      input({ participants: [{ ...asInput(ADULT), fullName: "Dospělý Opravený" }, asInput(CHILD)] }),
      SUPER,
    );
    expect(res.totalPrice).toBe(625);
    expect(participantUpdates()).toEqual([expect.objectContaining({ id: "p1", fullName: "Dospělý Opravený", mealPricingType: "SUPPORTED" })]);
  });

  it("refuses a NEW person on a tier the event does not offer", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored({ mealPricingTypes: ["STANDARD"] }));
    const newcomer = { ...asInput(CHILD), id: undefined, mealPricingType: "SUPPORTED" as const };
    await expect(
      applyFullUpdate("r1", input({ participants: [asInput(ADULT), asInput(CHILD), newcomer] }), SUPER),
    ).rejects.toBeInstanceOf(RegistrationPricingTypeUnavailableError);
  });

  it("a child re-booked as an adult is re-priced on both halves", async () => {
    const res = await applyFullUpdate(
      "r1",
      input({ participants: [asInput(ADULT), { ...asInput(CHILD), ageCategory: "AGE_15_PLUS" }] }),
      SUPER,
    );
    // 15+ STANDARD stay 300 + STANDARD lunch 120 = 420 instead of 180.
    expect(res.totalPrice).toBe(445 + 420);
    expect(h.tx.participantMeal.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["pm3"] } }, data: { price: 120 } });
  });
});

// ─── Status, concurrency, capacity ────────────────────────────────────────────

describe("applyFullUpdate — status, concurrency and capacity", () => {
  it("someone saved in between: 409, no participant write, no audit", async () => {
    h.tx.registration.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      applyFullUpdate("r1", input({ participants: [asInput(ADULT)] }), SUPER),
    ).rejects.toBeInstanceOf(RegistrationChangedError);
    expect(h.tx.participant.updateMany).not.toHaveBeenCalled();
    expect(h.logAuditEvent).not.toHaveBeenCalled();
  });

  it("un-cancelling onto a full event is refused before anything is written", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored({ status: "CANCELLED", maxRegistrations: 5 }));
    h.tx.registration.count.mockResolvedValueOnce(1).mockResolvedValueOnce(5); // still as loaded; 5 taken

    await expect(applyFullUpdate("r1", input({ status: "REGISTERED" }), SUPER)).rejects.toBeInstanceOf(
      RegistrationCapacityError,
    );
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1); // the Event row lock
    expect(h.tx.registration.count.mock.calls[1]![0].where).toMatchObject({
      eventId: "evt1", deletedAt: null, status: { in: ["REGISTERED", "PAID"] }, id: { not: "r1" },
    });
    expect(h.tx.registration.updateMany).not.toHaveBeenCalled();
  });

  it("un-cancelling with a free slot goes through; no limit means no lock at all", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored({ status: "CANCELLED", maxRegistrations: 5 }));
    h.tx.registration.count.mockResolvedValueOnce(1).mockResolvedValueOnce(4);
    await applyFullUpdate("r1", input({ status: "PAID" }), SUPER);
    expect(regWrite().data.status).toBe("PAID");

    vi.clearAllMocks();
    h.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(h.tx));
    h.tx.registration.updateMany.mockResolvedValue({ count: 1 });
    h.prisma.registration.findFirst.mockResolvedValue(stored({ status: "CANCELLED", maxRegistrations: null }));
    h.tx.registration.count.mockResolvedValue(1);
    await applyFullUpdate("r1", input(), SUPER);
    expect(h.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("a stale save that also un-cancels answers \"changed\", never \"event full\"", async () => {
    // Someone else re-activated it meanwhile (so the event may now be full because of them).
    h.prisma.registration.findFirst.mockResolvedValue(stored({ status: "CANCELLED", maxRegistrations: 5 }));
    h.tx.registration.count.mockResolvedValueOnce(0).mockResolvedValueOnce(5);
    await expect(applyFullUpdate("r1", input(), SUPER)).rejects.toBeInstanceOf(RegistrationChangedError);
    expect(h.tx.$queryRaw).not.toHaveBeenCalled();
    expect(h.tx.registration.updateMany).not.toHaveBeenCalled();
  });

  it("writes and returns the new updatedAt, so the editor can save again without reloading", async () => {
    const res = await applyFullUpdate("r1", input(), SUPER);
    expect(regWrite().data.updatedAt).toBeInstanceOf(Date);
    expect(res.updatedAt).toBe(regWrite().data.updatedAt.toISOString());
    expect(res.updatedAt).not.toBe(UPDATED_AT);
  });

  it("cancelling never checks capacity", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored({ maxRegistrations: 1 }));
    await applyFullUpdate("r1", input({ status: "CANCELLED" }), SUPER);
    expect(h.tx.registration.count).not.toHaveBeenCalled();
  });
});

// ─── Access, centre ───────────────────────────────────────────────────────────

describe("applyFullUpdate — access and home centre", () => {
  it("ADMIN of another centre → 403, nothing written; ADMIN of the event's centre may save", async () => {
    await expect(applyFullUpdate("r1", input(), adminOf("other"))).rejects.toBeInstanceOf(RegistrationForbiddenError);
    nothingWritten();
    await expect(applyFullUpdate("r1", input(), adminOf("evt-center"))).resolves.toMatchObject({ id: "r1" });
  });

  it("a missing registration (or one on a deleted event) → 404", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(null);
    await expect(applyFullUpdate("r1", input(), SUPER)).rejects.toBeInstanceOf(RegistrationNotFoundError);
    expect(h.prisma.registration.findFirst.mock.calls[0]![0].where).toEqual({
      id: "r1", deletedAt: null, event: { deletedAt: null },
    });
  });

  it("the stored home centre is kept without re-checking it; a changed one must be active", async () => {
    await applyFullUpdate("r1", input(), SUPER);
    expect(h.prisma.center.findFirst).not.toHaveBeenCalled();

    h.prisma.center.findFirst.mockResolvedValue(null);
    await expect(applyFullUpdate("r1", input({ centerId: "c-inactive" }), SUPER)).rejects.toBeInstanceOf(
      RegistrationCenterInvalidError,
    );
  });
});

// ─── Audit ────────────────────────────────────────────────────────────────────

describe("applyFullUpdate — audit", () => {
  it("records the whole before/after image, removed people included in the before", async () => {
    await applyFullUpdate("r1", input({ participants: [asInput(ADULT)], status: "PAID" }), SUPER);

    const entry = h.logAuditEvent.mock.calls[0]![0];
    expect(entry).toMatchObject({ action: "registration.full_update", entityType: "Registration", entityId: "r1", userId: "admin-1" });
    expect(entry.oldData).toMatchObject({ status: "REGISTERED", totalPrice: 625 });
    expect(entry.oldData.participants.map((p: { fullName: string }) => p.fullName)).toEqual(["Dospělý", "Dítě"]);
    expect(entry.newData).toMatchObject({ status: "PAID", totalPrice: 445 });
    expect(entry.newData.participants).toEqual([
      expect.objectContaining({ id: "p1", fullName: "Dospělý", mealPricingType: "SUPPORTED", totalPrice: 445, mealIds: ["b1", "l1"] }),
    ]);
  });
});

// ─── The live preview ─────────────────────────────────────────────────────────

describe("previewFullUpdate", () => {
  it("prices the editor's state positionally and writes nothing", async () => {
    const newcomer = { ...asInput(CHILD), id: undefined, fullName: "Nový", mealIds: [] };
    const res = await previewFullUpdate("r1", input({ participants: [asInput(ADULT), newcomer] }), SUPER);

    expect(res).toEqual({
      totalPrice: 445 + 120,
      participants: [
        { id: "p1", participationPrice: 300, mealPrice: 145, subtotal: 445 },
        { id: null, participationPrice: 120, mealPrice: 0, subtotal: 120 },
      ],
      mealDeadlinePassed: false,
    });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("says when the meal deadline has passed, and still prices the meals", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored({ mealRegistrationDeadline: new Date("2020-01-01") }));
    const res = await previewFullUpdate("r1", input(), SUPER);
    expect(res).toMatchObject({ totalPrice: 625, mealDeadlinePassed: true });
  });

  it("refuses exactly what the save refuses", async () => {
    await expect(previewFullUpdate("r1", input({ arrivalDateId: "d2" }), SUPER)).rejects.toBeInstanceOf(
      RegistrationMealInvalidError,
    );
  });
});

// ─── Existing paths the full edit depends on ──────────────────────────────────

describe("counts of people read only live participants (M50 removes people by soft delete)", () => {
  it("the admin registrations list", async () => {
    h.prisma.registration.findMany.mockResolvedValue([]);
    await listRegistrations(SUPER);
    expect(h.prisma.registration.findMany.mock.calls[0]![0].include._count).toEqual({
      select: { participants: { where: { deletedAt: null } } },
    });
  });

  it("the beds-per-night panel (and the export's accommodation sheet built from it)", async () => {
    h.prisma.event.findFirst.mockResolvedValue({ id: "evt1" });
    h.prisma.eventDate.findMany.mockResolvedValue(DATES);
    h.prisma.registration.findMany.mockResolvedValue([
      // What the database returns for a registration whose second person was removed.
      { arrivalDate: { sortOrder: 1 }, departureDate: { sortOrder: 3 }, _count: { participants: 1 } },
    ]);
    const nights = await getEventAccommodationStats("evt1", SUPER);
    expect(h.prisma.registration.findMany.mock.calls[0]![0].select._count).toEqual({
      select: { participants: { where: { deletedAt: null } } },
    });
    expect(nights.map((n) => n.count)).toEqual([1, 1]);
  });
});
