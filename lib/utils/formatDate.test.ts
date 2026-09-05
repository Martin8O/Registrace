import { describe, it, expect } from "vitest";
import { formatDateRangeShort, formatDeadlineDateTime } from "./formatDate";

// The meal cut-off is stored in UTC and read in Prague. That conversion is the
// whole point of the formatter: printed in UTC, the live Kolíňáci deadline reads
// two hours early, on the one number whose purpose is a cut-off. These pin the
// conversion at both offsets Prague has, and at the two instants where the
// conversion changes the calendar DAY as well as the clock.
describe("formatDeadlineDateTime", () => {
  it("renders a summer (CEST, +2) deadline in Prague wall-clock time", () => {
    // The live event's stored value — 23:59 Prague, not 21:59.
    expect(formatDeadlineDateTime("2026-09-16T21:59:00.000Z")).toBe("16. 9. 2026 23:59");
  });

  it("renders a winter (CET, +1) deadline in Prague wall-clock time", () => {
    expect(formatDeadlineDateTime("2026-01-15T22:30:00.000Z")).toBe("15. 1. 2026 23:30");
  });

  it("carries the date forward when Prague is already on the next day", () => {
    // 22:00Z in summer is 00:00 the following day in Prague — the case where
    // printing the UTC date would name the wrong day entirely.
    expect(formatDeadlineDateTime("2026-09-16T22:00:00.000Z")).toBe("17. 9. 2026 00:00");
  });

  it("keeps day and month unpadded and pads the clock", () => {
    expect(formatDeadlineDateTime("2026-03-05T08:07:00.000Z")).toBe("5. 3. 2026 09:07");
  });
});

describe("formatDateRangeShort", () => {
  it("renders a day.month range without leading zeros or a year", () => {
    expect(formatDateRangeShort("2026-09-18", "2026-09-20")).toBe("18.9.–20.9.");
    expect(formatDateRangeShort("2026-01-05", "2026-01-07")).toBe("5.1.–7.1.");
  });
});
