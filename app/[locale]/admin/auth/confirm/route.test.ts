import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// The invite / password-reset landing route puts its `[locale]` segment straight
// into a redirect target. Nothing upstream vets it: proxy.ts skips every path
// containing a dot, and the [locale] layout's 404 wraps pages, never a route
// handler. Route params arrive decoded, so `/%5Cevil.com/admin/auth/confirm`
// redirected to `/\evil.com/admin/login…` — which a browser resolves to another
// site: a link on our own domain landing an admin on someone else's login page.

const h = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp: h.verifyOtp } }),
}));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import { GET } from "./route";

const call = (locale: string, query = "") =>
  GET({ url: `https://registrace.online/x/admin/auth/confirm${query}` } as NextRequest, {
    params: Promise.resolve({ locale }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyOtp.mockResolvedValue({ error: null });
});

describe("GET /[locale]/admin/auth/confirm", () => {
  it.each(["\\evil.com", "/evil.com", "a.b", "CS"])(
    "never redirects into the unknown locale %s — it falls back to the default one",
    async (locale) => {
      await expect(call(locale)).rejects.toThrow("REDIRECT:/cs/admin/login?error=link_invalid");
      await expect(call(locale, "?token_hash=t&type=invite")).rejects.toThrow("REDIRECT:/cs/admin/set-password");
    },
  );

  it("keeps a real locale, and sends each kind of link where it belongs", async () => {
    await expect(call("en", "?token_hash=t&type=recovery")).rejects.toThrow("REDIRECT:/en/admin/set-password");
    await expect(call("en", "?token_hash=t&type=email_change")).rejects.toThrow(
      "REDIRECT:/en/admin/profile?emailChanged=1",
    );
    expect(h.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "t" });
  });

  it("an invalid or expired token goes back to the login, in the link's language", async () => {
    h.verifyOtp.mockResolvedValue({ error: new Error("expired") });
    await expect(call("en", "?token_hash=t&type=invite")).rejects.toThrow(
      "REDIRECT:/en/admin/login?error=link_invalid",
    );
  });
});
