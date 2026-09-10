// The cron endpoint's guard. The service behind it is mocked — what is proved
// here is that nothing runs without the bearer Vercel sends, that a deployment
// with no CRON_SECRET fails closed rather than open, that an authorised call is
// never throttled while failed attempts are, and that ?dryRun=1 reaches the
// service as a dry run. The last block pins vercel.json to this route: move or
// rename the route and the job would silently stop — this fails instead.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ run: vi.fn(), limit: vi.fn() }));
vi.mock("@/modules/events", () => ({ runEventLifecycle: h.run }));
// The limiter is a mock so the ORDER of the two checks can be asserted: what it
// would answer is set per test, and whether it was consulted at all is the point.
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: h.limit }));

import { GET } from "./route";

const SECRET = "s3cret-s3cret-s3cret-s3cret-s3cret";
const ROUTE_PATH = "/api/cron/event-lifecycle";

const call = (headers: Record<string, string> = {}, query = "") =>
  GET(new NextRequest(`http://localhost:3000${ROUTE_PATH}${query}`, { headers }));

const throttled = () => NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

beforeEach(() => {
  h.run.mockReset().mockResolvedValue({ checked: 0, closed: [], archived: [], dryRun: false });
  h.limit.mockReset().mockReturnValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/event-lifecycle", () => {
  it("fails closed when CRON_SECRET is not configured — 503, nothing runs", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const res = await call({ authorization: "Bearer anything" });

    expect(res.status).toBe(503);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("refuses a missing bearer", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    expect((await call()).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("refuses a wrong bearer", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    expect((await call({ authorization: `Bearer ${SECRET.slice(0, -1)}X` })).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("runs with the bearer Vercel sends and returns the summary", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const summary = { checked: 2, closed: [], archived: [{ id: "e1", title: "T" }], dryRun: false };
    h.run.mockResolvedValue(summary);

    const res = await call({ authorization: `Bearer ${SECRET}` });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: summary });
    expect(h.run).toHaveBeenCalledWith(expect.any(Date), { dryRun: false });
  });

  it("?dryRun=1 reaches the service as a dry run", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    await call({ authorization: `Bearer ${SECRET}` }, "?dryRun=1");

    expect(h.run).toHaveBeenCalledWith(expect.any(Date), { dryRun: true });
  });

  it("never throttles an authorised call — the bearer is checked before the limiter", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    h.limit.mockReturnValue(throttled());

    const res = await call({ authorization: `Bearer ${SECRET}` });

    expect(res.status).toBe(200);
    expect(h.limit).not.toHaveBeenCalled();
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("throttles failed attempts, so the secret cannot be guessed at speed", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    h.limit.mockReturnValue(throttled());

    const res = await call({ authorization: "Bearer wrong" });

    expect(res.status).toBe(429);
    expect(h.limit).toHaveBeenCalledTimes(1);
    expect(h.run).not.toHaveBeenCalled();
  });
});

describe("vercel.json", () => {
  const crons = (
    JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    }
  ).crons;

  it("schedules this route", () => {
    expect(crons.map((c) => c.path)).toContain(ROUTE_PATH);
  });

  it("uses a once-a-day expression — the Hobby plan rejects anything more frequent at deploy", () => {
    const schedule = crons.find((c) => c.path === ROUTE_PATH)!.schedule;
    // Fixed minute and hour, every day: "M H * * *".
    expect(schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});
