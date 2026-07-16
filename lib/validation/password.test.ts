import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checkPassword, isPasswordValid, MIN_LENGTH, PASSWORD_RULES } from "./password";

// The policy is UX-side only (Supabase Auth is the real gate — see the module
// header), so what these tests protect is that the checklist an admin reads is
// truthful: it must not tick a rule that is not met, and must not reject a
// password that satisfies everything.

describe("isPasswordValid", () => {
  it("rejects the passwords that used to get through", () => {
    // The old set-password rule was `length < 8`, so this passed.
    expect(isPasswordValid("aaaaaaaa")).toBe(false);
    // The old profile form checked nothing but the confirm field, leaving
    // Supabase's 6-char default as the only floor.
    expect(isPasswordValid("abcdef")).toBe(false);
    expect(isPasswordValid("abc")).toBe(false);
  });

  it("accepts a password that satisfies every rule", () => {
    expect(isPasswordValid("Tenovice-2026!")).toBe(true);
  });

  it("requires each class — one missing is enough to fail", () => {
    expect(isPasswordValid("tenovice-2026!")).toBe(false); // no uppercase
    expect(isPasswordValid("TENOVICE-2026!")).toBe(false); // no lowercase
    expect(isPasswordValid("Tenovice-abcd!")).toBe(false); // no digit
    expect(isPasswordValid("Tenovice20261")).toBe(false); // no symbol
    expect(isPasswordValid("Ten-20!")).toBe(false); // too short
  });

  it("counts length in characters, not bytes, and accepts Czech input", () => {
    expect("Přílišžluťoučký".length).toBeGreaterThanOrEqual(MIN_LENGTH);
    expect(isPasswordValid("Příliš-žluťoučký9")).toBe(true);
    // Accented letters must satisfy the letter classes (\p{Ll} / \p{Lu}).
    expect(checkPassword("ř").find((r) => r.id === "lowercase")?.met).toBe(true);
    expect(checkPassword("Ř").find((r) => r.id === "uppercase")?.met).toBe(true);
  });

  it("treats whitespace as neither a symbol nor filler that satisfies a class", () => {
    expect(checkPassword("Aa1     ").find((r) => r.id === "symbol")?.met).toBe(false);
    // …but a space still counts toward length, so it is usable in a passphrase.
    expect(isPasswordValid("Correct Horse 9!")).toBe(true);
  });

  it("accepts a non-ASCII symbol (Czech keyboards reach these more easily)", () => {
    expect(checkPassword("§").find((r) => r.id === "symbol")?.met).toBe(true);
    expect(checkPassword("€").find((r) => r.id === "symbol")?.met).toBe(true);
  });
});

describe("checkPassword — what the checklist renders", () => {
  it("returns every rule, in display order, even for an empty field", () => {
    const state = checkPassword("");
    expect(state.map((r) => r.id)).toEqual(["length", "lowercase", "uppercase", "digit", "symbol"]);
    expect(state.every((r) => !r.met)).toBe(true);
  });

  it("ticks exactly the rules that are met", () => {
    // Lowercase + digit only: short, no uppercase, no symbol.
    expect(checkPassword("abc123")).toEqual([
      { id: "length", met: false },
      { id: "lowercase", met: true },
      { id: "uppercase", met: false },
      { id: "digit", met: true },
      { id: "symbol", met: false },
    ]);
  });

  it("agrees with isPasswordValid — the button and the ticks cannot disagree", () => {
    for (const candidate of ["", "abc", "aaaaaaaa", "Tenovice-2026!", "Correct Horse 9!"]) {
      expect(isPasswordValid(candidate)).toBe(checkPassword(candidate).every((r) => r.met));
    }
  });
});

describe("every rule is labelled in both locales", () => {
  // A rule with no label would render as a raw key next to a tick — worse than
  // not showing the checklist at all.
  const keyFor: Record<string, string> = {
    length: "ruleLength",
    lowercase: "ruleLowercase",
    uppercase: "ruleUppercase",
    digit: "ruleDigit",
    symbol: "ruleSymbol",
  };

  it.each(["cs", "en"])("%s.json labels all of them", (locale) => {
    const messages = JSON.parse(
      readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), "utf8"),
    );
    const block = messages.admin?.passwordPolicy ?? {};
    const missing = PASSWORD_RULES.map((r) => keyFor[r.id]!).filter(
      (k) => typeof block[k] !== "string",
    );
    expect(missing).toEqual([]);
    for (const k of ["title", "met", "notMet", "notMetSummary"]) {
      expect(typeof block[k]).toBe("string");
    }
  });

  it("interpolates the length rule with the real minimum", () => {
    const messages = JSON.parse(
      readFileSync(new URL("../../locales/en.json", import.meta.url), "utf8"),
    );
    expect(messages.admin.passwordPolicy.ruleLength).toContain("{count}");
  });
});
