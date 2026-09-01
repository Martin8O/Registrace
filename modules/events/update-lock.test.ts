// What an already-live event will and will not let an admin change.
//
// WHY THIS EXISTS: M41 asked whether a participant could ever be stranded on a
// pricing tier their event no longer offers — the state the admin tier editor
// carries a backstop for. The answer is no, and the reason is here rather than
// in the UI: `updateEvent` replaces an event's relations ONLY for a DRAFT with
// zero registrations, and its scalar whitelist does not contain either tier set.
// So the two sets are frozen from the moment anything references the event, and
// nothing — not the wizard, not a hand-rolled API call — can narrow them under a
// registration that already chose from them.
//
// That reasoning is load-bearing for the whole two-tier feature, and until now it
// lived only in a code comment and a conversation. A future refactor that adds
// `participationPricingTypes` to the whitelist "for completeness" would silently
// re-open it; this fails instead.
//
// Prisma is mocked at the I/O boundary (same strategy as submit.test.ts) — there
// is no test database, and what is asserted is the shape of the write, not the DB.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdminContext } from "@/modules/auth";

const h = vi.hoisted(() => ({
  eventFindFirst: vi.fn(),
  eventUpdate: vi.fn(),
  transaction: vi.fn(),
  auditCreate: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    event: { findFirst: h.eventFindFirst, update: h.eventUpdate },
    $transaction: h.transaction,
  },
}));
vi.mock("@/lib/audit", () => ({ logAuditEvent: h.auditCreate }));

import { updateEvent } from "./index";

const ctx = { role: "SUPER_ADMIN", userId: "u1", ip: null, centerIds: [] } as unknown as AdminContext;

// The full payload an admin's wizard posts, tier sets included.
const fullPayload = {
  centerId: "another-centre",
  title_cs: "Nový název",
  title_en: "New title",
  startDate: new Date("2027-01-01T00:00:00.000Z"),
  endDate: new Date("2027-01-03T00:00:00.000Z"),
  participationPricingTypes: ["STANDARD"],
  mealPricingTypes: ["STANDARD"],
  dates: [],
  pricingRules: [],
  mealPricingRules: [],
  meals: [],
} as unknown as Parameters<typeof updateEvent>[1];

function existingEvent(status: string, registrations: number) {
  return {
    centerId: "c1",
    title_cs: "Původní",
    title_en: "Original",
    subtitle_cs: null,
    subtitle_en: null,
    description_cs: null,
    description_en: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    maxRegistrations: null,
    status,
    _count: { registrations },
  };
}

const writtenData = () => h.eventUpdate.mock.calls[0]![0].data as Record<string, unknown>;

beforeEach(() => {
  h.eventFindFirst.mockReset();
  h.eventUpdate.mockReset().mockResolvedValue({ id: "e1" });
  h.transaction.mockReset();
  h.auditCreate.mockReset().mockResolvedValue(undefined);
});

describe("an event that is live or already booked", () => {
  it.each(["PUBLISHED", "CLOSED", "ARCHIVED"])(
    "%s: neither tier set is written, however the payload asks",
    async (status) => {
      h.eventFindFirst.mockResolvedValue(existingEvent(status, 0));

      await updateEvent("e1", fullPayload, ctx);

      const data = writtenData();
      expect(data).not.toHaveProperty("participationPricingTypes");
      expect(data).not.toHaveProperty("mealPricingTypes");
      // The relation-replacing path is the only one that writes them, and it
      // must not have run at all.
      expect(h.transaction).not.toHaveBeenCalled();
    },
  );

  it("a DRAFT that already has a registration is locked too — the lock is not about publishing", async () => {
    h.eventFindFirst.mockResolvedValue(existingEvent("DRAFT", 1));

    await updateEvent("e1", fullPayload, ctx);

    expect(writtenData()).not.toHaveProperty("participationPricingTypes");
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("the centre and the dates are frozen with them (registrations reference those ids)", async () => {
    h.eventFindFirst.mockResolvedValue(existingEvent("PUBLISHED", 3));

    await updateEvent("e1", fullPayload, ctx);

    const data = writtenData();
    expect(data).not.toHaveProperty("centerId");
    expect(data).not.toHaveProperty("startDate");
    expect(data).not.toHaveProperty("endDate");
  });

  it("what IS still editable goes through: the descriptive scalars", async () => {
    h.eventFindFirst.mockResolvedValue(existingEvent("PUBLISHED", 3));

    await updateEvent("e1", fullPayload, ctx);

    expect(writtenData()).toMatchObject({ title_cs: "Nový název", title_en: "New title" });
  });
});

describe("a draft nobody has registered for", () => {
  it("takes the relation path, which is the only place the tier sets are written", async () => {
    h.eventFindFirst.mockResolvedValue(existingEvent("DRAFT", 0));
    // replaceDraftEventRelations runs everything inside one transaction; running
    // it is enough to prove which path was taken.
    h.transaction.mockResolvedValue(undefined);

    await updateEvent("e1", fullPayload, ctx);

    expect(h.transaction).toHaveBeenCalledTimes(1);
    // …and it did NOT fall through to the scalar-only write.
    expect(h.eventUpdate).not.toHaveBeenCalled();
  });
});
