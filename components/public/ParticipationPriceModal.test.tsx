// @vitest-environment jsdom
//
// The "Výpočet ceny za účast" popup — the informational breakdown behind the ⓘ on
// the participation-price row. It is display only (invariant 3), but it must agree
// with the engine to the crown, because a registrant reading it is being told how
// the number beside it was reached.
//
// The bug it was written for: it treated `dailyRate === 0` as "this category is not
// charged" and printed exactly that — beside a participation price of 400 CZK, to a
// 15+ adult, on the commonest kind of Těnovice event (no paid programme, 200 a
// night). Daily rate and night rate are separate fields of the same rule; either
// can be 0 on its own, so the note now depends on the whole breakdown being empty.
//
// The last case here re-computes every scenario through the REAL engine and compares
// totals, so the two can never drift apart silently.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { calculatePricing } from "@/modules/pricing";
import ParticipationPriceModal from "./ParticipationPriceModal";

const M = cs.form.participationModal;

type RuleOver = {
  dailyRate?: number;
  nightRate?: number;
  morningArrivalDiscount?: number;
  afternoonArrivalDiscount?: number;
  eveningArrivalDiscount?: number;
  earlyDepartureDiscount?: number;
};

const rule = (ageCategory: string, pricingType: string, over: RuleOver = {}) => ({
  id: `${ageCategory}-${pricingType}`,
  ageCategory,
  pricingType,
  dailyRate: 0,
  nightRate: 0,
  morningArrivalDiscount: 0,
  afternoonArrivalDiscount: 0,
  eveningArrivalDiscount: 0,
  earlyDepartureDiscount: 0,
  ...over,
});

type Scenario = {
  rules: ReturnType<typeof rule>[];
  ageCategory?: string;
  pricingType?: string;
  days?: number;
  arrivalTime?: string;
  earlyDeparture?: string;
  hasAccommodation?: boolean;
};

function open(s: Scenario) {
  const arrivalTime = s.arrivalTime ?? "MORNING";
  return render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <ParticipationPriceModal
        isOpen
        onClose={() => {}}
        participantNumber={1}
        ageCategory={s.ageCategory ?? "AGE_15_PLUS"}
        pricingType={s.pricingType ?? "STANDARD"}
        pricingRules={s.rules}
        days={s.days ?? 3}
        arrivalTime={arrivalTime}
        arrivalTimeLabel={cs.form.arrival_morning}
        earlyDeparture={s.earlyDeparture ?? "NONE"}
        hasAccommodation={s.hasAccommodation ?? true}
      />
    </NextIntlClientProvider>,
  );
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The breakdown as `[label, amount]` pairs, in the order rendered. */
function rows(): [string, string][] {
  return [...document.querySelectorAll("div")]
    .filter((d) => d.children.length === 2 && [...d.children].every((c) => c.tagName === "SPAN"))
    .map((d) => [clean(d.children[0]!.textContent), clean(d.children[1]!.textContent)]);
}

const labels = () => rows().map(([l]) => l);
const amountOf = (label: string) => rows().find(([l]) => l === label)?.[1];
const shows = (s: string) => clean(document.body.textContent).includes(clean(s));

// The event from the report: no paid programme, 200 a night, two stay tiers.
const NO_PROGRAMME = [
  rule("AGE_15_PLUS", "STANDARD", { nightRate: 200 }),
  rule("AGE_15_PLUS", "SURPLUS", { nightRate: 300 }),
  rule("AGE_0_3", "STANDARD"),
];

// The same event, but discounting a morning arrival — which lands on the nights,
// since that is all there is to discount.
const DISCOUNTED_NIGHTS = [
  rule("AGE_15_PLUS", "STANDARD", { nightRate: 200, morningArrivalDiscount: 30 }),
];

afterEach(cleanup);

describe("an event with no daily rate but a price per night", () => {
  // The reported bug, exactly: 400 CZK on the row, "you are not charged for
  // participation in this category" in the popup explaining it.
  it("explains the 400 CZK instead of denying it", () => {
    open({ rules: NO_PROGRAMME, days: 3, hasAccommodation: true });
    expect(shows(M.childNote)).toBe(false);
    expect(amountOf(cs.form.participationModal.total)).toBe("400 CZK");
    expect(labels()).toEqual([
      "Ubytování: 2 noci × 200 Kč",
      M.total,
    ]);
  });

  it("prices the nights from the participant's own stay tier", () => {
    open({ rules: NO_PROGRAMME, pricingType: "SURPLUS", days: 3, hasAccommodation: true });
    expect(amountOf(M.total)).toBe("600 CZK");
  });

  // Turning accommodation off is what leaves nothing to charge — and that, only
  // that, is the note. This is the toggle Martin was clicking when he hit the bug.
  it("falls back to the note once accommodation is turned off", () => {
    open({ rules: NO_PROGRAMME, days: 3, hasAccommodation: false });
    expect(shows(M.childNote)).toBe(true);
    expect(rows()).toEqual([]);
  });

  // "Účast: 3 dny × 0 Kč" is a line that carries no information — the daily rate
  // is genuinely 0, so the row is skipped rather than printed as a zero.
  // A discount is subtracted from the WHOLE participation price, nights included —
  // the engine has one running total, not one per field — so it still applies on an
  // event with no daily rate, and the popup has to show it being taken off.
  it("still subtracts an arrival discount from the nights", () => {
    open({ rules: DISCOUNTED_NIGHTS, days: 3, arrivalTime: "MORNING" });
    expect(labels()).toEqual([
      `Sleva za příjezd (${cs.form.arrival_morning})`,
      "Ubytování: 2 noci × 200 Kč",
      M.total,
    ]);
    expect(amountOf(M.total)).toBe("370 CZK");
  });

  it("never prints the 0 Kč daily-rate line", () => {
    open({ rules: NO_PROGRAMME, days: 3, hasAccommodation: true });
    expect(labels().some((l) => /^Účast:/.test(l))).toBe(false);
  });
});

describe("the note still appears where nothing is charged", () => {
  it("for a toddler on a free rule", () => {
    open({ rules: NO_PROGRAMME, ageCategory: "AGE_0_3", days: 3, hasAccommodation: true });
    expect(shows(M.childNote)).toBe(true);
  });

  it("for an age × tier the event has no rule for at all", () => {
    open({ rules: NO_PROGRAMME, ageCategory: "AGE_8_14", days: 3 });
    expect(shows(M.childNote)).toBe(true);
  });

  it("and the stay-first prompt shows while the dates are incomplete", () => {
    open({ rules: NO_PROGRAMME, days: 0 });
    expect(shows(M.selectStay)).toBe(true);
    expect(shows(M.childNote)).toBe(false);
  });
});

describe("an ordinary charged stay is unchanged", () => {
  const CHARGED = [
    rule("AGE_15_PLUS", "STANDARD", {
      dailyRate: 200,
      nightRate: 150,
      morningArrivalDiscount: 30,
      earlyDepartureDiscount: 50,
    }),
  ];

  it("lists the rate, the discounts and the nights, in that order", () => {
    open({
      rules: CHARGED,
      days: 3,
      arrivalTime: "MORNING",
      earlyDeparture: "AFTER_BREAKFAST",
      hasAccommodation: true,
    });
    expect(labels()).toEqual([
      "Účast: 3 dny × 200 Kč",
      `Sleva za příjezd (${cs.form.arrival_morning})`,
      M.earlyDepartureDiscount,
      "Ubytování: 2 noci × 150 Kč",
      M.total,
    ]);
    // 600 − 30 − 50 + 300
    expect(amountOf(M.total)).toBe("820 CZK");
  });

  it("drops the accommodation line when the visitor does not sleep there", () => {
    open({ rules: CHARGED, days: 3, hasAccommodation: false });
    expect(labels()).toEqual(["Účast: 3 dny × 200 Kč", "Sleva za příjezd (Dopoledne)", M.total]);
    expect(amountOf(M.total)).toBe("570 CZK");
  });
});

// The whole point of the popup is that its arithmetic IS the engine's. Every
// scenario above is re-priced through modules/pricing and the totals compared.
describe("the breakdown agrees with the real engine", () => {
  const engineTotal = (s: Scenario): number => {
    const days = s.days ?? 3;
    const eventDates = Array.from({ length: Math.max(days, 1) }, (_, i) => ({
      id: `d${i}`,
      date: `2026-09-${11 + i}`,
      sortOrder: i,
    }));
    return calculatePricing({
      participants: [
        {
          ageCategory: s.ageCategory ?? "AGE_15_PLUS",
          pricingType: s.pricingType ?? "STANDARD",
          mealIds: [],
        },
      ],
      pricingRules: s.rules,
      meals: [],
      eventDates,
      arrivalDateId: "d0",
      departureDateId: `d${days - 1}`,
      arrivalTime: s.arrivalTime ?? "MORNING",
      earlyDeparture: s.earlyDeparture ?? "NONE",
      hasAccommodation: s.hasAccommodation ?? true,
    }).participants[0]!.participationPrice;
  };

  const CHARGED = [
    rule("AGE_15_PLUS", "STANDARD", {
      dailyRate: 200,
      nightRate: 150,
      morningArrivalDiscount: 30,
      afternoonArrivalDiscount: 50,
      eveningArrivalDiscount: 80,
      earlyDepartureDiscount: 50,
    }),
  ];

  it.each([
    { name: "nights only", scenario: { rules: NO_PROGRAMME, days: 3 } },
    { name: "nights only, surplus", scenario: { rules: NO_PROGRAMME, days: 4, pricingType: "SURPLUS" } },
    { name: "nights only, no bed", scenario: { rules: NO_PROGRAMME, days: 3, hasAccommodation: false } },
    { name: "toddler", scenario: { rules: NO_PROGRAMME, ageCategory: "AGE_0_3", days: 3 } },
    { name: "nights, discounted arrival", scenario: { rules: DISCOUNTED_NIGHTS, days: 3 } },
    { name: "charged, morning", scenario: { rules: CHARGED, days: 3 } },
    { name: "charged, evening arrival", scenario: { rules: CHARGED, days: 2, arrivalTime: "EVENING" } },
    {
      name: "charged, early departure",
      scenario: { rules: CHARGED, days: 3, earlyDeparture: "AFTER_BREAKFAST" },
    },
    { name: "charged, single day", scenario: { rules: CHARGED, days: 1 } },
  ])("$name", ({ scenario }) => {
    open(scenario);
    const total = engineTotal(scenario);
    // A total of 0 is rendered as the note, not as a row — that IS the agreement.
    if (total === 0) expect(shows(M.childNote)).toBe(true);
    else expect(amountOf(M.total)).toBe(`${total} CZK`);
  });
});

// ─── One number, one name ────────────────────────────────────────────────────
// The stay half of the price is TWO fields of one rule — a daily rate and a rate
// per night — and on a real event either can be 0 on its own. Calling the sum
// "participation price" named one of them, which is how an event with no paid
// programme ended up showing 400 CZK under a heading that did not mention nights.
// The label now names both halves, and it has to say the same thing in all three
// places the same number appears: the price overview's first table, the row on
// the registration form, and the total inside the breakdown that explains it.
// Two of the three drifting apart would put two names for one amount on one
// screen — the exact confusion the wording was widened to remove.

describe("the label for this number", () => {
  it.each([
    ["cs", cs],
    ["en", en],
  ])("says the same thing in every place it appears (%s)", (_locale, messages) => {
    const onTheForm = messages.form.participation_price;
    expect(messages.form.participationModal.total).toBe(onTheForm);
    expect(messages.event.pricingModal.stayTitle).toBe(onTheForm);
  });
});
