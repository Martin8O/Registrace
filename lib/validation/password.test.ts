import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checkPassword, isPasswordValid, MIN_LENGTH, PASSWORD_RULES, SYMBOLS } from "./password";

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

  it("counts length in characters — stricter than GoTrue's byte count, which is the safe way to drift", () => {
    // Go's len() would call this 24 bytes; we hold the admin to 17 real characters.
    expect([..."Příliš-žluťoučký9"].length).toBe(17);
    expect(isPasswordValid("Příliš-žluťoučký9")).toBe(true);
    // 7 Czech characters = 14 bytes, so GoTrue's MinLength=12 would let it pass.
    // We reject it. Being stricter only ever disables the button — it can never
    // produce a password the checklist approved and Supabase then refused.
    expect([..."Žluťouč"].length).toBeLessThan(MIN_LENGTH);
    expect(isPasswordValid("Žluťouč")).toBe(false);
  });

  // The rules below mirror GoTrue's literal ASCII sets, checked with
  // strings.ContainsAny. Unicode-category checks (\p{Ll} / \p{Lu} / \p{Nd}) would
  // tick these and Supabase would still reject the password — a false green, the
  // one failure mode worth writing tests for.
  it("does NOT count Czech accented letters toward the letter rules", () => {
    expect(checkPassword("ř").find((r) => r.id === "lowercase")?.met).toBe(false);
    expect(checkPassword("Ř").find((r) => r.id === "uppercase")?.met).toBe(false);
    // Long enough, has a digit, has a symbol, and its only capital is Ž — which
    // GoTrue does not count. The plain l/u/o/k satisfy lowercase, so this fails on
    // the uppercase rule alone: exactly the password a Czech admin would pick and
    // the old Unicode-class check would have waved through.
    expect(isPasswordValid("Žluťoučký-2026")).toBe(false);
    expect(checkPassword("Žluťoučký-2026").filter((r) => !r.met).map((r) => r.id)).toEqual([
      "uppercase",
    ]);
  });

  it("does NOT count symbols outside GoTrue's set", () => {
    for (const ch of ["§", "€", "°", "„", "“", "–"]) {
      expect(checkPassword(ch).find((r) => r.id === "symbol")?.met).toBe(false);
    }
  });

  it("counts every symbol that IS in GoTrue's set", () => {
    for (const ch of [...SYMBOLS]) {
      expect(checkPassword(ch).find((r) => r.id === "symbol")?.met).toBe(true);
    }
  });

  it("does not count non-ASCII digits", () => {
    expect(checkPassword("٣").find((r) => r.id === "digit")?.met).toBe(false); // Arabic-Indic 3
  });

  it("treats whitespace as neither a symbol nor filler that satisfies a class", () => {
    expect(checkPassword("Aa1     ").find((r) => r.id === "symbol")?.met).toBe(false);
    // …but a space still counts toward length, so it is usable in a passphrase.
    expect(isPasswordValid("Correct Horse 9!")).toBe(true);
  });
});

describe("SYMBOLS mirrors GoTrue exactly", () => {
  // Pinned character-for-character against the set Supabase documents at
  // https://supabase.com/docs/guides/auth/password-security
  // If this fails, the dashboard policy and this checklist have drifted apart —
  // fix the set, do not update the expectation to match a widened one.
  it("is the documented set, no more and no less", () => {
    expect(SYMBOLS).toBe("!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~");
  });

  it("contains no letters, digits or whitespace", () => {
    expect([...SYMBOLS].filter((c) => /[a-zA-Z0-9\s]/.test(c))).toEqual([]);
  });

  it("has no duplicates (a typo when editing the set would show up here)", () => {
    expect(new Set([...SYMBOLS]).size).toBe([...SYMBOLS].length);
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

  // The symbol hint lists examples. Every one of them must actually satisfy the
  // rule — guidance that suggests a character GoTrue rejects is worse than none.
  it.each(["cs", "en"])("%s.json only gives symbol examples that pass the rule", (locale) => {
    const messages = JSON.parse(
      readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), "utf8"),
    );
    const hint: string = messages.admin.passwordPolicy.ruleSymbol;
    const examples = [...(hint.match(/\((?:např\.|e\.g\.)\s*(.+)\)/)?.[1] ?? "")].filter(
      (c) => !/\s/.test(c),
    );
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.filter((c) => !SYMBOLS.includes(c))).toEqual([]);
  });

  // Ž is a capital letter to a human and not to GoTrue. If the label does not say
  // so, the admin reads "uppercase letter ○" next to their Ž and concludes the
  // form is broken.
  it.each(["cs", "en"])("%s.json spells out that the letter rules are ASCII-only", (locale) => {
    const messages = JSON.parse(
      readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), "utf8"),
    );
    const p = messages.admin.passwordPolicy;
    expect(p.ruleLowercase).toContain("a–z");
    expect(p.ruleUppercase).toContain("A–Z");
    expect(p.ruleDigit).toContain("0–9");
  });
});
