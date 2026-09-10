// The scheduled job that writes the lifecycle status the calendar already implies.
//
// WHY THIS EXISTS: from B7 until M49 the status column was written only by hand.
// The public side never noticed — isPubliclyVisible derives visibility on read —
// but the admin list showed "Publikováno" on five events that had ended months
// earlier, because nothing ever wrote CLOSED or ARCHIVED. The derivation here is
// the single definition of WHEN each status becomes true, and the service tests
// pin the shape of the write: guarded by the status it read, audited as a system
// write, and idempotent, because Vercel's cron delivery can skip or repeat a run.
//
// Prisma is mocked at the I/O boundary (same strategy as update-lock.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventStatusValue } from "./index";

const h = vi.hoisted(() => ({
  eventFindMany: vi.fn(),
  eventUpdateMany: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { event: { findMany: h.eventFindMany, updateMany: h.eventUpdateMany } },
}));
vi.mock("@/lib/audit", () => ({ logAuditEvent: h.audit }));

import { deriveLifecycleTransition, isPubliclyVisible, runEventLifecycle } from "./index";

// endDate is stored as UTC midnight of the calendar day (invariant 11).
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

// A summer end day: 20:00 Europe/Prague (CEST) is 18:00Z.
const summerEnd = day("2026-07-05");
// A winter end day: 20:00 Europe/Prague (CET) is 19:00Z.
const winterEnd = day("2026-01-11");

describe("deriveLifecycleTransition", () => {
  it("leaves a PUBLISHED event alone before 20:00 Prague on its end day", () => {
    expect(
      deriveLifecycleTransition({ status: "PUBLISHED", endDate: summerEnd }, at("2026-07-05T17:59:59Z")),
    ).toBeNull();
  });

  it("closes a PUBLISHED event at 20:00 Prague on its end day — 18:00 UTC in summer", () => {
    expect(
      deriveLifecycleTransition({ status: "PUBLISHED", endDate: summerEnd }, at("2026-07-05T18:00:00Z")),
    ).toBe("CLOSED");
  });

  it("in winter the same 20:00 wall clock is 19:00 UTC", () => {
    expect(
      deriveLifecycleTransition({ status: "PUBLISHED", endDate: winterEnd }, at("2026-01-11T18:59:59Z")),
    ).toBeNull();
    expect(
      deriveLifecycleTransition({ status: "PUBLISHED", endDate: winterEnd }, at("2026-01-11T19:00:00Z")),
    ).toBe("CLOSED");
  });

  it("archives a CLOSED event at 20:00 Prague three days after the end day, not a minute before", () => {
    expect(
      deriveLifecycleTransition({ status: "CLOSED", endDate: summerEnd }, at("2026-07-08T17:59:59Z")),
    ).toBeNull();
    expect(
      deriveLifecycleTransition({ status: "CLOSED", endDate: summerEnd }, at("2026-07-08T18:00:00Z")),
    ).toBe("ARCHIVED");
  });

  it("takes a PUBLISHED event whose close was missed straight to ARCHIVED", () => {
    // The job runs once a day, best-effort: a skipped run must not leave the
    // event one step behind forever.
    expect(
      deriveLifecycleTransition({ status: "PUBLISHED", endDate: summerEnd }, at("2026-07-20T12:00:00Z")),
    ).toBe("ARCHIVED");
  });

  it.each(["DRAFT", "ARCHIVED"])("never touches a %s event, however old", (status) => {
    expect(
      deriveLifecycleTransition(
        { status: status as EventStatusValue, endDate: day("2020-01-01") },
        at("2026-07-20T12:00:00Z"),
      ),
    ).toBeNull();
  });

  it("a DST switch inside the three days does not move the archive moment off 20:00 Prague", () => {
    // Summer time ends on 2026-10-25. An event ending on the 24th closes at
    // 20:00 CEST (18:00Z) and archives on the 27th at 20:00 CET (19:00Z) — NOT at
    // 18:00Z, which is what "close + 72 hours" would have produced.
    const acrossDst = day("2026-10-24");
    expect(
      deriveLifecycleTransition({ status: "CLOSED", endDate: acrossDst }, at("2026-10-27T18:30:00Z")),
    ).toBeNull();
    expect(
      deriveLifecycleTransition({ status: "CLOSED", endDate: acrossDst }, at("2026-10-27T19:00:00Z")),
    ).toBe("ARCHIVED");
  });

  it("carries the three days across a year end", () => {
    // 2026-12-30 + 3 = 2027-01-02, 20:00 CET = 19:00Z. Pins the calendar
    // arithmetic to Date.UTC's overflow handling — a hand-rolled "+3" would pass
    // every other case in this file and be a day out here.
    const yearEnd = day("2026-12-30");
    expect(
      deriveLifecycleTransition({ status: "CLOSED", endDate: yearEnd }, at("2027-01-02T18:59:59Z")),
    ).toBeNull();
    expect(
      deriveLifecycleTransition({ status: "CLOSED", endDate: yearEnd }, at("2027-01-02T19:00:00Z")),
    ).toBe("ARCHIVED");
  });

  it("agrees with isPubliclyVisible: a PUBLISHED event is visible exactly while there is nothing to write", () => {
    const event = { status: "PUBLISHED" as const, endDate: summerEnd };
    for (const iso of ["2026-07-05T17:59:59Z", "2026-07-05T18:00:00Z", "2026-07-08T18:00:00Z"]) {
      const now = at(iso);
      expect(isPubliclyVisible(event, now)).toBe(deriveLifecycleTransition(event, now) === null);
    }
  });
});

describe("runEventLifecycle", () => {
  // A typical run: 02:15 UTC = 04:15 Prague in summer.
  const now = at("2026-07-20T02:15:00Z");

  const published = (id: string, endIso: string, title = id) => ({
    id,
    title_cs: title,
    status: "PUBLISHED" as const,
    endDate: day(endIso),
  });
  const closed = (id: string, endIso: string, title = id) => ({
    id,
    title_cs: title,
    status: "CLOSED" as const,
    endDate: day(endIso),
  });

  beforeEach(() => {
    h.eventFindMany.mockReset().mockResolvedValue([]);
    h.eventUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    h.audit.mockReset().mockResolvedValue(undefined);
  });

  it("looks only at live PUBLISHED/CLOSED events whose end day has begun", async () => {
    await runEventLifecycle(now);

    expect(h.eventFindMany).toHaveBeenCalledTimes(1);
    expect(h.eventFindMany.mock.calls[0]![0].where).toEqual({
      deletedAt: null,
      status: { in: ["PUBLISHED", "CLOSED"] },
      endDate: { lte: now },
    });
  });

  it("writes each due transition guarded by the status it read, and audits it as a system write", async () => {
    h.eventFindMany.mockResolvedValue([
      published("old", "2026-06-28", "2. přípravný víkend"), // ended weeks ago → ARCHIVED
      closed("recent", "2026-07-12"), // closed, its three days are up → ARCHIVED
      published("yesterday", "2026-07-19"), // closed at 20:00 last night → CLOSED
    ]);

    const result = await runEventLifecycle(now);

    expect(result).toEqual({
      checked: 3,
      closed: [{ id: "yesterday", title: "yesterday" }],
      archived: [
        { id: "old", title: "2. přípravný víkend" },
        { id: "recent", title: "recent" },
      ],
      dryRun: false,
    });
    expect(h.eventUpdateMany).toHaveBeenCalledTimes(3);
    expect(h.eventUpdateMany).toHaveBeenCalledWith({
      where: { id: "old", status: "PUBLISHED", deletedAt: null },
      data: { status: "ARCHIVED" },
    });
    expect(h.eventUpdateMany).toHaveBeenCalledWith({
      where: { id: "yesterday", status: "PUBLISHED", deletedAt: null },
      data: { status: "CLOSED" },
    });
    expect(h.audit).toHaveBeenCalledTimes(3);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: "event.status_change",
        entityType: "Event",
        entityId: "old",
        oldData: { status: "PUBLISHED" },
        newData: expect.objectContaining({ status: "ARCHIVED" }),
      }),
    );
  });

  it("checks an event that is not yet due and leaves it alone", async () => {
    // Ends today: it closes at 20:00 Prague tonight, and the run is at 04:15.
    h.eventFindMany.mockResolvedValue([published("today", "2026-07-20")]);

    const result = await runEventLifecycle(now);

    expect(result.checked).toBe(1);
    expect(result.closed).toEqual([]);
    expect(result.archived).toEqual([]);
    expect(h.eventUpdateMany).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("skips an event somebody moved first — the guard hit nothing, so no audit entry either", async () => {
    h.eventFindMany.mockResolvedValue([published("raced", "2026-06-28")]);
    h.eventUpdateMany.mockResolvedValue({ count: 0 });

    const result = await runEventLifecycle(now);

    expect(result.archived).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("a dry run reports the same plan and writes nothing", async () => {
    h.eventFindMany.mockResolvedValue([
      published("old", "2026-06-28"),
      published("yesterday", "2026-07-19"),
    ]);

    const result = await runEventLifecycle(now, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.closed.map((e) => e.id)).toEqual(["yesterday"]);
    expect(result.archived.map((e) => e.id)).toEqual(["old"]);
    expect(h.eventUpdateMany).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
});
