import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { runEventLifecycle } from "@/modules/events";

// GET /api/cron/event-lifecycle — the scheduled job Vercel invokes once a day
// (vercel.json → crons). It writes the lifecycle status the calendar already
// implies: PUBLISHED → CLOSED after 20:00 Prague on the end day, → ARCHIVED after
// 20:00 three days later (runEventLifecycle in modules/events owns the rule).
//
// Outside proxy.ts's matcher on purpose, like the public API: there is no
// session to check — the caller is Vercel, which sends `Authorization: Bearer
// <CRON_SECRET>` by itself once that variable exists on the project. FAIL-CLOSED:
// no secret configured → 503 and nothing runs, so a deployment that forgot the
// variable cannot turn this into an open endpoint.
//
// The bearer is checked BEFORE the rate limit, and only failed attempts are
// throttled. The other order would let a flood of unauthenticated requests 429
// the one call that matters: Vercel does not retry a failed cron run, and a
// throttled run looks exactly like the bug this endpoint exists to fix. Failed
// attempts are still limited (10/min per IP), so the secret cannot be guessed at
// speed.
//
// `?dryRun=1` reports what WOULD change without writing — that is how the first
// production run is checked before it is trusted. Vercel's cron delivery is
// best-effort (a run can be missed or repeated), which is exactly why the service
// reconciles state instead of taking a step: running it twice changes nothing
// the second time.
//
// force-dynamic: a cached response would be served without executing anything,
// and Vercel does not even log a cron invocation that returned from cache.
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set — refusing to run event-lifecycle");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  if (!isAuthorized(req, secret)) {
    const limited = enforceRateLimit(req, { bucket: "cron", limit: 10, windowMs: 60_000 });
    if (limited) return limited;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const result = await runEventLifecycle(new Date(), { dryRun });
  console.info(
    `[cron] event-lifecycle${dryRun ? " (dry run)" : ""}: checked ${result.checked}, ` +
      `closed ${result.closed.length}, archived ${result.archived.length}`,
  );
  return NextResponse.json({ data: result });
}
