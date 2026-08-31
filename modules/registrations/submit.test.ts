import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RegistrationSubmitInput } from "@/lib/validation";

// ─── Mock the I/O boundary, keep the real pricing engine ──────────────────────
// We test submitRegistration's CONTROL FLOW (idempotency / honeypot / capacity /
// not-found / stay-mismatch) against a mocked Prisma — no live DB exists for tests
// (Supabase is the only instance). The pricing engine runs FOR REAL so the
// persisted totalPrice reflects real arithmetic end-to-end. vi.hoisted gives the
// vi.mock factories access to the shared mock objects (factories run before imports).

const h = vi.hoisted(() => {
  const registration = {
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const event = { findFirst: vi.fn(), update: vi.fn() };
  const center = { findFirst: vi.fn() };
  const participant = { create: vi.fn() };
  const participantMeal = { createMany: vi.fn() };
  const prisma = {
    registration,
    event,
    center,
    participant,
    participantMeal,
    // Run the transaction callback against the same mocked delegates.
    $transaction: vi.fn(),
  };
  const sendRegistrationConfirmation = vi.fn();
  return { prisma, sendRegistrationConfirmation };
});

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/email", () => ({ sendRegistrationConfirmation: h.sendRegistrationConfirmation }));
vi.mock("@/modules/events", () => ({ isPubliclyVisible: () => true }));
vi.mock("@/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import {
  submitRegistration,
  RegistrationCapacityError,
  RegistrationEventNotFoundError,
  RegistrationStayMismatchError,
  RegistrationPricingTypeUnavailableError,
} from "./index";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeEvent = {
  id: "evt1",
  status: "PUBLISHED",
  endDate: new Date("2030-01-01"),
  maxRegistrations: null as number | null,
  mealRegistrationDeadline: null as Date | null,
  title_cs: "Akce",
  title_en: "Event",
  startDate: new Date("2026-05-01"),
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  dates: [
    { id: "d_fri", date: new Date("2026-05-01"), label_cs: "Pá", label_en: "Fri", sortOrder: 0 },
    { id: "d_sun", date: new Date("2026-05-03"), label_cs: "Ne", label_en: "Sun", sortOrder: 2 },
  ],
  meals: [
    { id: "m_b", eventDateId: "d_fri", mealType: "BREAKFAST", price: 80, isClosed: false, label_cs: "Snídaně", label_en: "Breakfast" },
  ],
  pricingRules: [
    {
      ageCategory: "AGE_15_PLUS",
      pricingType: "STANDARD",
      dailyRate: 100,
      nightRate: 50,
      morningArrivalDiscount: 0,
      afternoonArrivalDiscount: 50,
      eveningArrivalDiscount: 100,
      earlyDepartureDiscount: 80,
    },
    { ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", dailyRate: 30, nightRate: 50, morningArrivalDiscount: 0, afternoonArrivalDiscount: 50, eveningArrivalDiscount: 100, earlyDepartureDiscount: 80 },
    { ageCategory: "AGE_15_PLUS", pricingType: "SURPLUS", dailyRate: 200, nightRate: 50, morningArrivalDiscount: 0, afternoonArrivalDiscount: 50, eveningArrivalDiscount: 100, earlyDepartureDiscount: 80 },
  ],
  // Both tier sets, all three each — the column default every event carries (M40).
  participationPricingTypes: ["STANDARD", "SUPPORTED", "SURPLUS"],
  mealPricingTypes: ["STANDARD", "SUPPORTED", "SURPLUS"],
};

// A meal price list where the tier actually moves the price, so a test can tell
// which of the two tiers priced the breakfast.
const TIERED_MEAL_RULES = [
  { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", price: 80 },
  { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", price: 50 },
  { mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SURPLUS", price: 110 },
];

const fakeCenter = { id: "c1", name_cs: "Praha", name_en: "Prague" };

const validInput: RegistrationSubmitInput = {
  eventId: "evt1",
  arrivalDateId: "d_fri",
  arrivalTime: "MORNING",
  departureDateId: "d_sun",
  earlyDeparture: "NONE",
  hasAccommodation: false,
  honeypot: "",
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  centerId: "c1",
  email: "jan@example.cz",
  gdprConsent: true,
  participants: [{ fullName: "Jan Novák", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", mealType: "MEAT", mealIds: ["m_b"] }],
};

const meta = { ipAddress: "127.0.0.1", lang: "cs" as const };

// Re-establish a clean happy-path mock state before each test.
beforeEach(() => {
  vi.resetAllMocks();
  h.prisma.registration.findUnique.mockResolvedValue(null);
  h.prisma.event.findFirst.mockResolvedValue({ ...fakeEvent, maxRegistrations: null });
  h.prisma.center.findFirst.mockResolvedValue(fakeCenter);
  h.prisma.registration.count.mockResolvedValue(0);
  h.prisma.registration.create.mockResolvedValue({ id: "reg1" });
  h.prisma.registration.update.mockResolvedValue({ id: "reg1" });
  // Atomic per-event registrant counter consumed by the number allocator.
  h.prisma.event.update.mockResolvedValue({ registrationSeq: 1, numberPrefix: "26002" });
  h.prisma.participant.create.mockResolvedValue({ id: "p1" });
  h.prisma.participantMeal.createMany.mockResolvedValue({ count: 1 });
  h.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      registration: h.prisma.registration,
      participant: h.prisma.participant,
      participantMeal: h.prisma.participantMeal,
      event: h.prisma.event,
    }),
  );
  h.sendRegistrationConfirmation.mockResolvedValue({ sent: true });
});

describe("submitRegistration", () => {
  it("valid payload → persists with real price and returns registrationId", async () => {
    const res = await submitRegistration(validInput, meta);

    expect(res).toEqual({ registrationId: "reg1", confirmationSent: true });
    // Real engine: STANDARD, 3 days (sortOrder 0→2), morning (disc 0), + meal 80 = 380.
    expect(h.prisma.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalPrice: 380 }) }),
    );
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("allocates a human-readable registration number from the event's atomic counter", async () => {
    h.prisma.event.update.mockResolvedValue({ registrationSeq: 108, numberPrefix: "26002" });

    await submitRegistration(validInput, meta);

    expect(h.prisma.event.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { registrationSeq: { increment: 1 } } }),
    );
    expect(h.prisma.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ registrationNumber: "260020108" }) }),
    );
  });

  it("persists the visitor's locale so a later resend mails in their language (P6)", async () => {
    await submitRegistration(validInput, { ipAddress: "127.0.0.1", lang: "en" });

    expect(h.prisma.registration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ locale: "en" }) }),
    );
  });

  it("duplicate idempotencyKey → returns existing row, no new insert", async () => {
    h.prisma.registration.findUnique.mockResolvedValue({ id: "existing", confirmationSentAt: new Date() });

    const res = await submitRegistration(validInput, meta);

    expect(res).toEqual({ registrationId: "existing", confirmationSent: true });
    expect(h.prisma.event.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("honeypot filled → bot sentinel, nothing touches the DB", async () => {
    const res = await submitRegistration({ ...validInput, honeypot: "spam" }, meta);

    expect(res).toEqual({ registrationId: "bot-detected", confirmationSent: false });
    expect(h.prisma.registration.findUnique).not.toHaveBeenCalled();
  });

  it("missing event → RegistrationEventNotFoundError", async () => {
    h.prisma.event.findFirst.mockResolvedValue(null);
    await expect(submitRegistration(validInput, meta)).rejects.toBeInstanceOf(RegistrationEventNotFoundError);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("capacity reached → RegistrationCapacityError (checked inside the transaction)", async () => {
    h.prisma.event.findFirst.mockResolvedValue({ ...fakeEvent, maxRegistrations: 1 });
    h.prisma.registration.count.mockResolvedValue(1);
    await expect(submitRegistration(validInput, meta)).rejects.toBeInstanceOf(RegistrationCapacityError);
    expect(h.prisma.registration.create).not.toHaveBeenCalled();
  });

  it("stay id not on the event → RegistrationStayMismatchError", async () => {
    await expect(
      submitRegistration({ ...validInput, arrivalDateId: "ghost" }, meta),
    ).rejects.toBeInstanceOf(RegistrationStayMismatchError);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("a failed confirmation email does not block the registration", async () => {
    h.sendRegistrationConfirmation.mockResolvedValue({ sent: false, error: "test mode" });

    const res = await submitRegistration(validInput, meta);

    expect(res).toEqual({ registrationId: "reg1", confirmationSent: false });
    // confirmationSentAt is only written on success → no update call here.
    expect(h.prisma.registration.update).not.toHaveBeenCalled();
  });
});

// ─── Two independent pricing tiers (M40) ──────────────────────────────────────
// The stay and the meals are priced by two separate choices. This is the boundary
// where an incoming payload's missing meal tier is filled in — and where a tier
// the event does not offer is refused.

describe("submitRegistration — the two pricing tiers", () => {
  const participant = (over: Record<string, unknown> = {}) => ({
    ...validInput,
    participants: [{ ...validInput.participants[0]!, mealIds: ["m_b"], ...over }],
  });
  const tieredEvent = (over: Record<string, unknown> = {}) => {
    h.prisma.event.findFirst.mockResolvedValue({
      ...fakeEvent,
      mealPricingRules: TIERED_MEAL_RULES,
      ...over,
    });
  };
  const participantData = () => h.prisma.participant.create.mock.calls[0]?.[0]?.data;
  const mealSnapshotPrices = () =>
    h.prisma.participantMeal.createMany.mock.calls[0]?.[0]?.data.map(
      (r: { price: number }) => r.price,
    );

  it("prices the stay and the meals from the two tiers independently", async () => {
    tieredEvent();

    await submitRegistration(
      participant({ pricingType: "SURPLUS", mealPricingType: "SUPPORTED" }),
      meta,
    );

    // Surplus room over 3 days = 600; supported breakfast = 50.
    expect(participantData()).toMatchObject({
      participationPrice: 600,
      mealPrice: 50,
      totalPrice: 650,
    });
  });

  it("persists both tiers on the participant", async () => {
    tieredEvent();

    await submitRegistration(
      participant({ pricingType: "SURPLUS", mealPricingType: "SUPPORTED" }),
      meta,
    );

    expect(participantData()).toMatchObject({
      pricingType: "SURPLUS",
      mealPricingType: "SUPPORTED",
    });
  });

  it("snapshots each meal at the MEAL tier's price, not the stay tier's", async () => {
    tieredEvent();

    await submitRegistration(
      participant({ pricingType: "SURPLUS", mealPricingType: "SUPPORTED" }),
      meta,
    );

    expect(mealSnapshotPrices()).toEqual([50]);
  });

  it("an omitted meal tier falls back to the participant's OWN tier, not STANDARD", async () => {
    // A client written before M40 sends one tier, and that tier priced its meals
    // too. Falling back to STANDARD would re-price this supported person's
    // breakfast from 50 up to 80 the moment M40a shipped.
    tieredEvent();

    await submitRegistration(participant({ pricingType: "SUPPORTED" }), meta);

    expect(participantData()).toMatchObject({ mealPrice: 50, mealPricingType: "SUPPORTED" });
    expect(mealSnapshotPrices()).toEqual([50]);
  });

  it("rejects a stay tier the event does not offer, writing nothing", async () => {
    tieredEvent({ participationPricingTypes: ["STANDARD"] });

    await expect(
      submitRegistration(participant({ pricingType: "SUPPORTED" }), meta),
    ).rejects.toBeInstanceOf(RegistrationPricingTypeUnavailableError);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a meal tier the event does not offer, writing nothing", async () => {
    tieredEvent({ mealPricingTypes: ["STANDARD"] });

    await expect(
      submitRegistration(
        participant({ pricingType: "STANDARD", mealPricingType: "SURPLUS" }),
        meta,
      ),
    ).rejects.toBeInstanceOf(RegistrationPricingTypeUnavailableError);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("accepts a stay tier the event offers for meals only in the other set", async () => {
    // The two sets are independent: an event may tier its meals while charging one
    // price for the room. Nothing is propagated between them.
    tieredEvent({ participationPricingTypes: ["STANDARD"] });

    await submitRegistration(
      participant({ pricingType: "STANDARD", mealPricingType: "SURPLUS" }),
      meta,
    );

    expect(participantData()).toMatchObject({
      participationPrice: 300,
      mealPrice: 110,
      pricingType: "STANDARD",
      mealPricingType: "SURPLUS",
    });
  });
});
// ─── The confirmation email carries both tiers, at every age (M40c) ───────────
// The mail used to print ONE tier and blank it out under 15 — the pre-M37
// invariant 15, from when tiers were a 15+ concept. The engine never had that age
// branch, so a parent of a supported child was mailed a dash where the tier that
// produced their amount should have been.

describe("submitRegistration — the confirmation email's tiers", () => {
  const emailData = () => h.sendRegistrationConfirmation.mock.calls[0]?.[0];

  const twoPeople = (over: Record<string, unknown> = {}): RegistrationSubmitInput => ({
    ...validInput,
    participants: [
      {
        fullName: "Jan Novák",
        ageCategory: "AGE_15_PLUS",
        pricingType: "SURPLUS",
        mealPricingType: "SUPPORTED",
        mealType: "MEAT",
        mealIds: ["m_b"],
      },
      {
        // A child on a non-standard tier — the case that used to render "—".
        fullName: "Eva Malá",
        ageCategory: "AGE_8_14",
        pricingType: "SUPPORTED",
        mealPricingType: "STANDARD",
        mealType: "VEGETARIAN",
        mealIds: [],
      },
    ],
    ...over,
  });

  it("mails both tiers for an adult AND for a child", async () => {
    h.prisma.event.findFirst.mockResolvedValue({
      ...fakeEvent,
      mealPricingRules: TIERED_MEAL_RULES,
    });

    await submitRegistration(twoPeople(), meta);

    expect(emailData().participants).toEqual([
      expect.objectContaining({
        fullName: "Jan Novák",
        pricingType: "SURPLUS",
        mealPricingType: "SUPPORTED",
      }),
      expect.objectContaining({
        fullName: "Eva Malá",
        ageCategory: "AGE_8_14",
        pricingType: "SUPPORTED",
        mealPricingType: "STANDARD",
      }),
    ]);
  });

  it("mails the meal tier a missing one was filled in from, never STANDARD", async () => {
    // A pre-M40 client sends one tier; the service fills the meal tier from that
    // person's own tier. The mail must state what they were actually charged at.
    h.prisma.event.findFirst.mockResolvedValue({
      ...fakeEvent,
      mealPricingRules: TIERED_MEAL_RULES,
    });

    await submitRegistration(
      {
        ...validInput,
        participants: [
          {
            fullName: "Jan Novák",
            ageCategory: "AGE_15_PLUS",
            pricingType: "SUPPORTED",
            mealType: "MEAT",
            mealIds: ["m_b"],
          },
        ],
      },
      meta,
    );

    expect(emailData().participants[0]).toMatchObject({
      pricingType: "SUPPORTED",
      mealPricingType: "SUPPORTED",
    });
  });
});
