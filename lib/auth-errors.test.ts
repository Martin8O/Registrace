import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { authErrorKey } from "./auth-errors";

// lib/auth-errors is pure and dependency-free — no IO boundaries to stub.
// The value it guards is that an admin sees a REASON in their own language, so
// the tests that matter are: the codes we promise to cover map to a key, and
// every key we can return actually exists in BOTH locales (a key that resolves
// to nothing would render as the raw key string in the UI).

describe("authErrorKey — mapping Supabase codes to wording", () => {
  it("maps the password-change codes an admin can actually hit", () => {
    expect(authErrorKey("weak_password")).toBe("weakPassword");
    expect(authErrorKey("same_password")).toBe("samePassword");
    expect(authErrorKey("over_request_rate_limit")).toBe("rateLimited");
  });

  it("maps the e-mail-change codes", () => {
    expect(authErrorKey("email_exists")).toBe("emailExists");
    expect(authErrorKey("email_address_invalid")).toBe("emailInvalid");
    expect(authErrorKey("over_email_send_rate_limit")).toBe("emailRateLimited");
  });

  it("collapses the several ways a session can be gone onto one message", () => {
    for (const code of [
      "session_expired",
      "session_not_found",
      "refresh_token_not_found",
      "refresh_token_already_used",
    ]) {
      expect(authErrorKey(code)).toBe("sessionExpired");
    }
  });

  // The callers fall back to their generic message (plus the raw English reason)
  // only when this returns null, so null must mean "genuinely unknown".
  it("returns null for an unknown code and for a missing one", () => {
    expect(authErrorKey("some_future_gotrue_code")).toBeNull();
    expect(authErrorKey(undefined)).toBeNull();
  });

  it("does not match on the human message by accident", () => {
    expect(authErrorKey("Password is known to be weak and easy to guess")).toBeNull();
  });
});

describe("every mapped key is translated in both locales", () => {
  const keys = [
    ...new Set(
      [...readFileSync(new URL("./auth-errors.ts", import.meta.url), "utf8").matchAll(/return "([a-zA-Z]+)";/g)].map(
        (m) => m[1]!,
      ),
    ),
  ];

  it("finds the mapper's keys (guards against the regex silently matching nothing)", () => {
    expect(keys.length).toBeGreaterThan(5);
  });

  it.each(["cs", "en"])("%s.json defines admin.authErrors for all of them", (locale) => {
    const messages = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
    );
    const block = messages.admin?.authErrors ?? {};
    expect(keys.filter((k) => typeof block[k] !== "string")).toEqual([]);
  });
});
