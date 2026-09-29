// How a new event gets its frozen registration-number prefix (`YYEEE`).
//
// WHY THIS EXISTS: audit 2026-09-06 S3. The prefix used to be "number of events
// starting this year + 1". A draft's start date can move to another year after its
// prefix is frozen, which lowered that count, so the next create re-issued a
// prefix already taken — the @unique rejected it, the wizard showed "saving
// failed, try again", and every retry failed identically until someone edited the
// database. The prefix is now one past the HIGHEST issued for the year, and a
// collision (two admins creating at once) is retried once.
//
// Prisma is mocked at the I/O boundary (same strategy as update-lock.test.ts): a
// tiny in-memory list of issued prefixes stands in for the Event table.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdminContext } from "@/modules/auth";
import type { EventCreateWithRelationsInput } from "@/lib/validation";

const h = vi.hoisted(() => ({
  prefixes: [] as string[],
  eventCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

function findHighest({ where }: { where: { numberPrefix: { startsWith: string } } }) {
  const matching = h.prefixes.filter((p) => p.startsWith(where.numberPrefix.startsWith)).sort();
  const top = matching.at(-1);
  return Promise.resolve(top ? { numberPrefix: top } : null);
}

vi.mock("@/lib/db", () => {
  const tx = {
    event: { findFirst: findHighest, create: h.eventCreate },
    eventDate: { create: vi.fn() },
    pricingRule: { createMany: vi.fn() },
    mealPricingRule: { createMany: vi.fn() },
    eventMeal: { createMany: vi.fn() },
  };
  return { prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/audit", () => ({ logAuditEvent: h.auditCreate }));

import { createEvent, nextNumberPrefix } from "./index";

const ctx = { role: "SUPER_ADMIN", userId: "u1", ip: null, centerIds: [] } as unknown as AdminContext;

const input = {
  title_cs: "Akce",
  title_en: "Event",
  centerId: "c1",
  status: "DRAFT",
  startDate: new Date("2026-11-20T00:00:00Z"),
  endDate: new Date("2026-11-22T00:00:00Z"),
  dates: [],
  pricingRules: [],
  mealPricingRules: [],
  meals: [],
} as unknown as EventCreateWithRelationsInput;

// Records every prefix the create was attempted with; `failWith` makes the next
// N attempts collide on the unique index before recording succeeds.
function issueOnCreate(failTimes = 0) {
  let failures = failTimes;
  h.eventCreate.mockImplementation(({ data }: { data: { numberPrefix: string } }) => {
    if (failures > 0) {
      failures -= 1;
      // A competing create took this prefix first.
      h.prefixes.push(data.numberPrefix);
      return Promise.reject(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    }
    h.prefixes.push(data.numberPrefix);
    return Promise.resolve({
      id: `ev-${data.numberPrefix}`,
      ...data,
      maxRegistrations: null,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  });
}

beforeEach(() => {
  h.prefixes = [];
  h.eventCreate.mockReset();
  h.auditCreate.mockReset();
});

describe("nextNumberPrefix", () => {
  it("starts a year at 001", () => {
    expect(nextNumberPrefix(2027, null)).toBe("27001");
  });

  it("is one past the highest issued ordinal", () => {
    expect(nextNumberPrefix(2026, "26016")).toBe("26017");
    expect(nextNumberPrefix(2026, "26099")).toBe("26100");
  });
});

describe("createEvent — registration-number prefix", () => {
  it("issues one past the highest prefix of the event's year", async () => {
    h.prefixes = ["25003", "26001", "26002", "26016"];
    issueOnCreate();

    await createEvent(input, ctx);

    expect(h.eventCreate).toHaveBeenCalledTimes(1);
    expect(h.eventCreate.mock.calls[0][0].data.numberPrefix).toBe("26017");
  });

  it("does not re-issue a prefix after a draft moved to another year (audit S3)", async () => {
    // 26001–26003 were issued in 2026; the draft holding 26003 was then moved to
    // January 2027. Only two events still START in 2026 — the old count-based rule
    // produced 26003 again here and failed on the unique index forever.
    h.prefixes = ["26001", "26002", "26003"];
    issueOnCreate();

    await createEvent(input, ctx);

    expect(h.eventCreate.mock.calls[0][0].data.numberPrefix).toBe("26004");
  });

  it("gives the first event of a new year 001, ignoring other years", async () => {
    h.prefixes = ["26001", "26017"];
    issueOnCreate();

    await createEvent({ ...input, startDate: new Date("2027-01-10T00:00:00Z") }, ctx);

    expect(h.eventCreate.mock.calls[0][0].data.numberPrefix).toBe("27001");
  });

  it("retries once with a fresh prefix when a concurrent create took it", async () => {
    h.prefixes = ["26005"];
    issueOnCreate(1);

    const result = await createEvent(input, ctx);

    const attempted = h.eventCreate.mock.calls.map((c) => c[0].data.numberPrefix);
    expect(attempted).toEqual(["26006", "26007"]);
    expect(result.id).toBe("ev-26007");
    expect(h.auditCreate).toHaveBeenCalledTimes(1);
  });

  it("gives up after the one retry rather than looping", async () => {
    issueOnCreate(2);

    await expect(createEvent(input, ctx)).rejects.toMatchObject({ code: "P2002" });
    expect(h.eventCreate).toHaveBeenCalledTimes(2);
    expect(h.auditCreate).not.toHaveBeenCalled();
  });

  it("does not retry an error that is not a unique collision", async () => {
    h.eventCreate.mockRejectedValue(new Error("connection lost"));

    await expect(createEvent(input, ctx)).rejects.toThrow("connection lost");
    expect(h.eventCreate).toHaveBeenCalledTimes(1);
  });
});
