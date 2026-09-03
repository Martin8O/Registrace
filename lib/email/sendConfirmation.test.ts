// The confirmation email's own wording.
//
// This is the least observable surface in the app. A wrong label in the admin
// panel is seen the next time someone opens the page; a wrong label in a
// confirmation email is seen only by the person who receives one, and by then it
// has already been sent. Everything else about the mail is covered by
// submit.test.ts — but that suite asserts the DATA reaching it (names, tiers,
// amounts), never its words, so until now the words were the one user-facing
// text in the project with nothing at all holding them to anything.
//
// What they are held to is the locale files, because the registrant reads both:
// they fill the form on the site, then get the mail, and one amount must not
// arrive under two different names.

import { describe, it, expect } from "vitest";
import { TEXT } from "./sendConfirmation";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

const LOCALES = { cs, en } as const;

describe("the email speaks the same language as the site", () => {
  // The stay half of the price is a daily rate AND a rate per night, either of
  // which can be 0 alone — which is why the label names both. The mail used to
  // say "účast" / "stay": one of them a half-truth, the other a third word for
  // the same thing, neither matching what the registrant had just read.
  it.each([
    ["cs", "účast a noc"],
    ["en", "participation and night"],
  ])("names both halves of the stay price the way the form does (%s)", (lang, expected) => {
    const messages = LOCALES[lang as keyof typeof LOCALES];
    expect(TEXT[lang as "cs" | "en"].tier_participation).toBe(expected);
    // The form's label is the same words with the price noun attached, so the
    // mail's shorter label has to be contained in it rather than equal to it.
    expect(messages.form.participation_price.toLowerCase()).toContain(expected);
  });

  // The meal half deliberately gets NO such cross-check. "Cena za stravu" and
  // "meals" cannot be held against "strava" and "meals" by containment — Czech
  // declines the noun and English pluralises it — and a test contorted until it
  // passes says nothing. Its presence is covered below; its wording did not
  // change and has no second name to disagree with.

  // The two tier labels sit side by side in one table cell ("účast a noc:
  // standardní cena / strava: podporovaná cena"), so if one were ever dropped
  // the mail would render the raw key beside a real label — the same failure
  // the component suites catch by using the real locale files.
  it.each([["cs"], ["en"]])("has every key its own table cell needs (%s)", (lang) => {
    for (const key of ["tier_participation", "tier_meals", "none_dash"]) {
      expect(TEXT[lang as "cs" | "en"][key], `${lang}.${key}`).toBeTruthy();
    }
  });

  // Both languages must carry the same keys: a key present in one and missing
  // in the other renders as the raw key for exactly half the recipients, which
  // is the kind of thing only a foreign-language reader would ever report.
  it("defines the same keys in both languages", () => {
    expect(Object.keys(TEXT.en).sort()).toEqual(Object.keys(TEXT.cs).sort());
  });
});
