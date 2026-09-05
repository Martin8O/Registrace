import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdminContext } from "@/modules/auth";

// ─── Mock the I/O boundary (same pattern as update-repricing.test.ts) ─────────
// Prisma and Resend are mocked — no test DB exists and no mail may leave a test
// run. What is asserted here is not the template but the GATE in front of it.

const h = vi.hoisted(() => ({
  prisma: {
    registration: { findFirst: vi.fn(), update: vi.fn() },
  },
  logAuditEvent: vi.fn(),
  sendRegistrationConfirmation: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: h.prisma }));
vi.mock("@/lib/audit", () => ({ logAuditEvent: h.logAuditEvent }));
vi.mock("@/lib/email", () => ({
  sendRegistrationConfirmation: h.sendRegistrationConfirmation,
}));

import { resendConfirmation, RegistrationCancelledError } from "./index";

const CTX = {
  userId: "admin-1",
  role: "SUPER_ADMIN",
  centerIds: [],
  ip: null,
} as unknown as AdminContext;

// The minimum a confirmation needs: one adult, one day, no meals. The mail's
// content is asserted in sendConfirmation.test.ts — here it only has to be
// buildable, so that a refusal cannot be mistaken for a crash on missing data.
const stored = (status: "REGISTERED" | "PAID" | "CANCELLED") => ({
  id: "r1",
  registrationNumber: "2026-0001",
  email: "guest@example.com",
  locale: "cs",
  status,
  totalPrice: 380,
  hasAccommodation: true,
  arrivalTime: "MORNING",
  earlyDeparture: "NONE",
  event: {
    id: "e1",
    centerId: "c1",
    title_cs: "Akce",
    title_en: "Event",
    startDate: new Date("2026-05-01T00:00:00.000Z"),
    endDate: new Date("2026-05-01T00:00:00.000Z"),
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  },
  center: { name_cs: "Praha", name_en: "Prague" },
  arrivalDate: { label_cs: "Pátek 1.5.", label_en: "Friday 1 May" },
  departureDate: { label_cs: "Pátek 1.5.", label_en: "Friday 1 May" },
  participants: [
    {
      fullName: "Pokus",
      ageCategory: "AGE_15_PLUS",
      pricingType: "STANDARD",
      mealPricingType: "STANDARD",
      mealType: "MEAT",
      totalPrice: 380,
      meals: [],
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  h.sendRegistrationConfirmation.mockResolvedValue({ sent: true });
  h.prisma.registration.update.mockResolvedValue({});
});

describe("resendConfirmation — the cancelled gate", () => {
  it("refuses a CANCELLED registration and sends NOTHING", async () => {
    h.prisma.registration.findFirst.mockResolvedValue(stored("CANCELLED"));

    await expect(resendConfirmation("r1", CTX)).rejects.toBeInstanceOf(
      RegistrationCancelledError,
    );

    // The point of the whole gate: the mail is headed "Potvrzení registrace"
    // and prints an amount to pay, so for a cancelled booking it states the
    // opposite of the truth. It must not be attempted, not merely reported as
    // failed afterwards.
    expect(h.sendRegistrationConfirmation).not.toHaveBeenCalled();
    // And confirmationSentAt keeps pointing at the last confirmation that WAS
    // true — a refused resend is not a send.
    expect(h.prisma.registration.update).not.toHaveBeenCalled();
  });

  it("still sends for REGISTERED and for PAID", async () => {
    for (const status of ["REGISTERED", "PAID"] as const) {
      vi.clearAllMocks();
      h.sendRegistrationConfirmation.mockResolvedValue({ sent: true });
      h.prisma.registration.update.mockResolvedValue({});
      h.prisma.registration.findFirst.mockResolvedValue(stored(status));

      await expect(resendConfirmation("r1", CTX)).resolves.toEqual({
        confirmationSent: true,
        error: undefined,
      });
      expect(h.sendRegistrationConfirmation).toHaveBeenCalledTimes(1);
      // The stamp moves only on a real send (asserted per status, so a gate
      // widened to "anything but REGISTERED" would fail here rather than pass).
      expect(h.prisma.registration.update).toHaveBeenCalledTimes(1);
    }
  });
});
