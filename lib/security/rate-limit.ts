// lib/security/rate-limit — in-memory, best-effort rate limiting (P4, decision A).
// Edge- and Node-safe (pure JS: Map + Date.now + NextResponse only — no Node APIs,
// no Prisma), so the SAME module serves proxy.ts (edge runtime) and the public
// route handlers (node runtime).
//
// LIMITATION (deliberate, documented): the counters live in a module-level Map,
// i.e. in ONE serverless/edge instance's memory. On Vercel every cold start gets
// fresh memory and concurrent instances count independently — so a "10/hr" limit
// behaves as "10/hr per live instance" and resets on recycle. This is honest
// friction against casual abuse/bursts, NOT a hard global guarantee. The public
// interface is intentionally swappable: replace the Map internals with a durable
// store (Postgres / Upstash Redis) later WITHOUT touching any call site.

import { NextResponse } from "next/server";

// Client IP (single source of truth — was file-local in registration/submit).
// Structural param so it accepts a Request/NextRequest AND a next/headers
// ReadonlyHeaders wrapper (`{ headers }`) without casting.
//
// Prefer the platform-set SINGLE-value header (Vercel sets x-real-ip to the
// genuine client IP and a client cannot forge it). Only fall back to
// x-forwarded-for[0], whose leftmost segment is trustworthy on a BARE Vercel
// deploy (Vercel overwrites XFF) — if a reverse proxy / CDN is ever placed in
// front of the app, revisit this, as that segment becomes client-spoofable and
// would let an attacker rotate forged IPs past the per-IP limits.
type HasHeaders = { headers: { get(name: string): string | null } };
export function clientIp(req: HasHeaders): string | null {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return null;
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
// Hard ceiling on distinct live keys. Once reached (after sweeping expired
// entries) we FAIL CLOSED for new keys rather than growing memory — so a
// sustained unique-key flood (e.g. rotated IPs) degrades to rejection, not OOM.
const MAX_KEYS = 50_000;

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number };

// Fixed-window counter. Returns ok=false once `limit` is exceeded within the
// current window; the window resets lazily once `resetAt` passes.
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      // At capacity: drop everything already expired first…
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      // …and if the live set is STILL full, refuse the new key (fail closed).
      if (buckets.size >= MAX_KEYS) {
        return { ok: false, remaining: 0, resetAt: now + windowMs };
      }
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { ok: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

// The shared 429 rejection (invariant: distinct from the 400 validation contract
// and the 403 CSRF/role rejections). Carries Retry-After in whole seconds.
export function rateLimitResponse(rl: RateLimitResult): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

// Convenience: check + (on exceed) return a ready 429, else null. Lets a handler
// do `const limited = enforceRateLimit(req, {...}); if (limited) return limited;`.
export function enforceRateLimit(
  req: Request,
  opts: { bucket: string; limit: number; windowMs: number },
): NextResponse | null {
  const rl = rateLimit(`${opts.bucket}:${clientIp(req) ?? "unknown"}`, opts.limit, opts.windowMs);
  return rl.ok ? null : rateLimitResponse(rl);
}
