import { describe, it, expect, afterEach } from "vitest";
import { isSameOrigin, isMutating } from "./csrf";

// The CSRF origin gate, with the emphasis on what must NOT be accepted.
//
// The preview-origin allowance (a Vercel preview is served from *.vercel.app, not
// from the canonical NEXT_PUBLIC_APP_URL, so admin writes 403'd there) is the kind
// of change that quietly widens a security control if it is a little off. These
// pin both halves: previews accept their OWN url, production still accepts only the
// canonical origin — including when a Vercel URL is present in the environment.

const CANONICAL = "https://registrace.online";

function req(origin: string | null, method = "POST", referer?: string): Request {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  return new Request("https://example.test/api/admin/events", { method, headers });
}

const ENV_KEYS = ["NEXT_PUBLIC_APP_URL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "NODE_ENV"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
}

afterEach(() => setEnv(saved as never));

describe("isMutating", () => {
  it("covers the state-changing verbs and not the safe ones", () => {
    expect(["POST", "PUT", "PATCH", "DELETE"].every(isMutating)).toBe(true);
    expect(["GET", "HEAD", "OPTIONS"].some(isMutating)).toBe(false);
  });
});

describe("isSameOrigin — production", () => {
  it("accepts the canonical origin", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: CANONICAL, VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(isSameOrigin(req(CANONICAL))).toBe(true);
  });

  it("rejects a foreign origin", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: CANONICAL, VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(isSameOrigin(req("https://evil.example"))).toBe(false);
  });

  it("rejects a request with no Origin and no Referer", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: CANONICAL, VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(isSameOrigin(req(null))).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: CANONICAL, VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(isSameOrigin(req(null, "POST", `${CANONICAL}/cs/admin/events`))).toBe(true);
    expect(isSameOrigin(req(null, "POST", "https://evil.example/x"))).toBe(false);
  });

  it("rejects localhost in production", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: CANONICAL, VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(isSameOrigin(req("http://localhost:3000"))).toBe(false);
  });

  // The regression that matters: production must NOT start trusting a vercel.app
  // origin just because the deployment has one.
  it("does NOT accept the deployment's vercel.app url in production", () => {
    setEnv({
      NEXT_PUBLIC_APP_URL: CANONICAL,
      VERCEL_ENV: "production",
      NODE_ENV: "production",
      VERCEL_URL: "registrace-abc123.vercel.app",
      VERCEL_BRANCH_URL: "registrace-git-main-martin.vercel.app",
    });
    expect(isSameOrigin(req("https://registrace-abc123.vercel.app"))).toBe(false);
    expect(isSameOrigin(req("https://registrace-git-main-martin.vercel.app"))).toBe(false);
  });

  it("fails closed when NEXT_PUBLIC_APP_URL is missing or unparseable", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: undefined, VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(isSameOrigin(req(CANONICAL))).toBe(false);
    setEnv({ NEXT_PUBLIC_APP_URL: "not a url" });
    expect(isSameOrigin(req(CANONICAL))).toBe(false);
  });
});

describe("isSameOrigin — Vercel preview", () => {
  const preview = {
    NEXT_PUBLIC_APP_URL: CANONICAL,
    VERCEL_ENV: "preview",
    NODE_ENV: "production",
    VERCEL_URL: "registrace-xyz789.vercel.app",
    VERCEL_BRANCH_URL: "registrace-git-feat-pricing-martin.vercel.app",
  } as const;

  it("accepts the branch url it is served from", () => {
    setEnv(preview);
    expect(isSameOrigin(req("https://registrace-git-feat-pricing-martin.vercel.app"))).toBe(true);
  });

  it("accepts the per-deployment url too", () => {
    setEnv(preview);
    expect(isSameOrigin(req("https://registrace-xyz789.vercel.app"))).toBe(true);
  });

  it("still accepts the canonical origin", () => {
    setEnv(preview);
    expect(isSameOrigin(req(CANONICAL))).toBe(true);
  });

  it("still rejects a foreign origin, and any OTHER vercel.app deployment", () => {
    setEnv(preview);
    expect(isSameOrigin(req("https://evil.example"))).toBe(false);
    expect(isSameOrigin(req("https://someone-elses-app.vercel.app"))).toBe(false);
  });

  it("accepts nothing extra when Vercel exposes no url", () => {
    setEnv({ ...preview, VERCEL_URL: undefined, VERCEL_BRANCH_URL: undefined });
    expect(isSameOrigin(req("https://registrace-xyz789.vercel.app"))).toBe(false);
    expect(isSameOrigin(req(CANONICAL))).toBe(true);
  });
});
