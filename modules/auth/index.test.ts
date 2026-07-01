import { describe, it, expect, afterEach, vi } from "vitest";

// modules/auth pulls in the Prisma client + Supabase server client at import time
// (via getAdminContext's deps). We only exercise the pure, env-driven owner-tier
// helpers here, so stub the IO boundaries to keep the import cheap and side-effect
// free (same strategy as submit.test.ts / export.test.ts).
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { isOwnerEmail, isOwnerUserId } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isOwnerUserId — immutable owner anchor", () => {
  it("matches a configured user id (case-insensitive, trims list whitespace)", () => {
    vi.stubEnv("OWNER_USER_IDS", " AAAA-1111 , bbbb-2222 ");
    expect(isOwnerUserId("aaaa-1111")).toBe(true);
    expect(isOwnerUserId("BBBB-2222")).toBe(true);
  });

  it("rejects a non-listed id, and fails closed when unset/empty", () => {
    vi.stubEnv("OWNER_USER_IDS", "aaaa-1111");
    expect(isOwnerUserId("cccc-3333")).toBe(false);
    expect(isOwnerUserId(null)).toBe(false);
    vi.stubEnv("OWNER_USER_IDS", "");
    expect(isOwnerUserId("aaaa-1111")).toBe(false);
  });
});

describe("isOwnerEmail — mutable, verified-only fallback", () => {
  it("matches a configured email case-insensitively", () => {
    vi.stubEnv("OWNER_EMAILS", "Owner@Bdc.cz");
    expect(isOwnerEmail("owner@bdc.cz")).toBe(true);
    expect(isOwnerEmail("someone@else.cz")).toBe(false);
  });

  it("fails closed on empty/unset or null email", () => {
    vi.stubEnv("OWNER_EMAILS", "");
    expect(isOwnerEmail("owner@bdc.cz")).toBe(false);
    vi.stubEnv("OWNER_EMAILS", "owner@bdc.cz");
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
  });
});
