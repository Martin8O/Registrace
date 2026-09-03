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
import { TEXT, buildHtml, type ConfirmationEmailData } from "./sendConfirmation";
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

// ─── The meals-by-day summary ────────────────────────────────────────────────
// The summary is built inside the template, so its collapsing is observable
// ONLY in the rendered HTML — and this is an email: nobody can go back and look
// at what was sent. The shape it replaced listed one person's slots as a
// comma-separated run and repeated it per person, which on ten people eating
// everything is fourteen lines of the same ten names.

const CS = TEXT.cs;

function mail(over: Partial<ConfirmationEmailData>): ConfirmationEmailData {
  return {
    registrationNumber: "26018001",
    to: "nobody@example.cz",
    eventTitle: "Kolíňáci",
    eventStart: new Date("2026-09-18"),
    eventEnd: new Date("2026-09-20"),
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    arrivalLabel: "Pátek",
    arrivalTime: "MORNING",
    departureLabel: "Neděle",
    earlyDeparture: "NONE",
    hasAccommodation: true,
    centerName: "Kolín",
    participants: [],
    totalPrice: 0,
    ...over,
  };
}

const person = (fullName: string, meals: { day: string; order: number; mealType: string }[]) => ({
  fullName,
  ageCategory: "AGE_15_PLUS",
  pricingType: "STANDARD",
  mealPricingType: "STANDARD",
  mealType: "MEAT",
  meals,
  subtotal: 100,
});

/** The rendered mail as plain text, whitespace-collapsed — what a reader sees. */
const textOf = (data: ConfirmationEmailData) =>
  buildHtml(data, "cs")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Just the meals section, so an assertion cannot accidentally match elsewhere. */
const mealsSection = (data: ConfirmationEmailData) => {
  const all = textOf(data);
  const from = all.indexOf(CS.meals_by_day!);
  const to = all.indexOf(CS.participants!, from);
  return all.slice(from, to === -1 ? undefined : to);
};

const FRI = { day: "Pátek 18. 9.", order: 0 };
const SAT = { day: "Sobota 19. 9.", order: 1 };
const fullDay = (d: { day: string; order: number }) =>
  ["BREAKFAST", "LUNCH", "DINNER"].map((mealType) => ({ ...d, mealType }));

describe("the meals summary collapses what would otherwise repeat", () => {
  it("puts one day's meals on ONE line when the same people ordered them all", () => {
    const out = mealsSection(mail({ participants: [person("Jan", fullDay(SAT)), person("Eva", fullDay(SAT))] }));
    expect(out).toContain(`${CS.BREAKFAST} · ${CS.LUNCH} · ${CS.DINNER}`);
  });

  it("names the group rather than everyone in it when nobody is missing", () => {
    const out = mealsSection(mail({ participants: [person("Jan", fullDay(SAT)), person("Eva", fullDay(SAT))] }));
    expect(out).toContain(CS.everyone!);
    expect(out).not.toContain("Jan");
    expect(out).not.toContain("Eva");
  });

  // The exception is the information — that is the whole point of naming the
  // rule "everyone" and spelling out only who departs from it.
  it("spells out the names when only some of them ordered it", () => {
    const out = mealsSection(
      mail({
        participants: [
          person("Jan", [{ ...FRI, mealType: "DINNER" }]),
          person("Eva", []),
        ],
      }),
    );
    expect(out).toContain("Jan");
    expect(out).not.toContain(CS.everyone!);
  });

  it("splits a day into two lines when its meals have different eaters", () => {
    const out = mealsSection(
      mail({
        participants: [
          person("Jan", [{ ...SAT, mealType: "BREAKFAST" }, { ...SAT, mealType: "LUNCH" }]),
          person("Eva", [{ ...SAT, mealType: "LUNCH" }]),
        ],
      }),
    );
    // Lunch is the shared one, breakfast is Jan's alone.
    expect(out).toContain(`${CS.LUNCH} ${CS.everyone}`);
    expect(out).toContain(CS.BREAKFAST!);
    expect(out).toContain("Jan");
  });

  // Two people can share a name, and grouping on names would merge their two
  // different sets into one wrong line — so the grouping keys on the index.
  it("does not merge two namesakes who ordered different meals", () => {
    const out = mealsSection(
      mail({
        participants: [
          person("Jan Novák", [{ ...SAT, mealType: "BREAKFAST" }]),
          person("Jan Novák", [{ ...SAT, mealType: "LUNCH" }]),
        ],
      }),
    );
    expect(out).toContain(CS.BREAKFAST!);
    expect(out).toContain(CS.LUNCH!);
    expect(out).not.toContain(CS.everyone!);
  });

  it("names nobody at all when the registration is for one person", () => {
    const out = mealsSection(mail({ participants: [person("Jan", fullDay(SAT))] }));
    expect(out).toContain(`${CS.BREAKFAST} · ${CS.LUNCH} · ${CS.DINNER}`);
    expect(out).not.toContain("Jan");
    expect(out).not.toContain(CS.everyone!);
  });

  // Days are ordered by the event day's sortOrder, never by the label — a label
  // is human text ("Pátek", "Sobota") and does not sort into calendar order.
  it("orders the days by the event's own order, not by their labels", () => {
    const out = mealsSection(
      mail({
        participants: [
          person("Jan", [
            { day: "Zítra", order: 1, mealType: "LUNCH" },
            { day: "Dnes", order: 0, mealType: "LUNCH" },
          ]),
        ],
      }),
    );
    expect(out.indexOf("Dnes")).toBeLessThan(out.indexOf("Zítra"));
  });

  it("counts every ordered slot at the foot of the section", () => {
    const out = mealsSection(mail({ participants: [person("Jan", fullDay(SAT)), person("Eva", fullDay(FRI))] }));
    expect(out).toContain(`${CS.meals_total}: 6`);
  });

  it("says so in words when nothing was ordered, instead of an empty grid", () => {
    const out = mealsSection(mail({ participants: [person("Jan", [])] }));
    expect(out).toContain(CS.meals_none!);
    expect(out).not.toContain(CS.meals_total!);
  });
});
