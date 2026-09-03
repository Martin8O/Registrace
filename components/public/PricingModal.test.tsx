// @vitest-environment jsdom
//
// The public "Přehled cen" popup. What it must never do is print a grid of zeros:
// the commonest Těnovice weekend charges nothing per day, nothing for anyone under
// 15 and nothing to feed a toddler, and before this those three facts took eight
// cells of "0 CZK" each while the two numbers that matter (200/night, 300/night)
// sat at the bottom. An all-zero COLUMN and an all-zero CATEGORY are dropped whole;
// a category priced on one tier and free on another keeps every row, because
// dropping only the free row reads as "standard is missing", not "standard is free".
//
// Messages come from the REAL locale file, so a missing key fails here instead of
// rendering as a raw key in front of a registrant.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import cs from "@/locales/cs.json";
import PricingModal from "./PricingModal";

const M = cs.event.pricingModal;

const meals = [
  { id: "m_b", eventDateId: "d1", mealType: "BREAKFAST" as const, price: 80, isClosed: false },
  { id: "m_l", eventDateId: "d1", mealType: "LUNCH" as const, price: 120, isClosed: false },
  { id: "m_d", eventDateId: "d1", mealType: "DINNER" as const, price: 100, isClosed: false },
];

const AGES = ["AGE_0_3", "AGE_4_7", "AGE_8_14", "AGE_15_PLUS"] as const;
const TIERS = ["STANDARD", "SUPPORTED", "SURPLUS"] as const;
type Age = (typeof AGES)[number];
type Tier = (typeof TIERS)[number];

/** Stay rules from a `[dailyRate, nightRate]` table; anything unlisted is free. */
function stayRules(table: Partial<Record<Age, Partial<Record<Tier, [number, number]>>>>) {
  return AGES.flatMap((ageCategory) =>
    TIERS.map((pricingType) => {
      const [dailyRate, nightRate] = table[ageCategory]?.[pricingType] ?? [0, 0];
      return {
        id: `${ageCategory}-${pricingType}`,
        ageCategory,
        pricingType,
        dailyRate,
        nightRate,
        morningArrivalDiscount: 0,
        afternoonArrivalDiscount: 0,
        eveningArrivalDiscount: 0,
        earlyDepartureDiscount: 0,
      };
    }),
  );
}

/** Meal rules from a `[breakfast, lunch, dinner]` table per age × tier. */
function mealRules(table: Partial<Record<Age, Partial<Record<Tier, [number, number, number]>>>>) {
  return AGES.flatMap((ageCategory) =>
    TIERS.flatMap((pricingType) => {
      const [b, l, d] = table[ageCategory]?.[pricingType] ?? [0, 0, 0];
      return [
        { id: `${ageCategory}-${pricingType}-B`, mealType: "BREAKFAST" as const, ageCategory, pricingType, price: b },
        { id: `${ageCategory}-${pricingType}-L`, mealType: "LUNCH" as const, ageCategory, pricingType, price: l },
        { id: `${ageCategory}-${pricingType}-D`, mealType: "DINNER" as const, ageCategory, pricingType, price: d },
      ];
    }),
  );
}

function open(
  over: {
    pricingRules?: ReturnType<typeof stayRules>;
    mealPricingRules?: ReturnType<typeof mealRules>;
    participationPricingTypes?: string[];
    mealPricingTypes?: string[];
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <PricingModal
        isOpen
        onClose={() => {}}
        meals={meals}
        pricingRules={over.pricingRules ?? stayRules({})}
        mealPricingRules={over.mealPricingRules ?? mealRules({})}
        participationPricingTypes={over.participationPricingTypes ?? [...TIERS]}
        mealPricingTypes={over.mealPricingTypes ?? [...TIERS]}
      />
    </NextIntlClientProvider>,
  );
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** One rendered table as `{ columns, rows }` — rows keyed by their category label. */
function table(index: number) {
  const el = document.querySelectorAll("table")[index];
  if (!el) return null;
  const ths = [...el.querySelectorAll("thead th")].map(text);
  const rows: Record<string, string[]> = {};
  for (const tr of el.querySelectorAll("tbody tr")) {
    const tds = [...tr.querySelectorAll("td")].map(text);
    rows[tds[0]!] = tds.slice(1);
  }
  return { columns: ths.slice(1), rows };
}

const tier = (age: string, t: string) => `${age} · ${t}`;

// The event Martin created: no paid programme, nothing charged under 15, and the
// toddlers eat free. Two tiers on the stay, one on the meals.
const KOLINACKA = {
  pricingRules: stayRules({ AGE_15_PLUS: { STANDARD: [0, 200], SURPLUS: [0, 300] } }),
  mealPricingRules: mealRules({
    AGE_4_7: { STANDARD: [40, 60, 50] },
    AGE_8_14: { STANDARD: [40, 60, 50] },
    AGE_15_PLUS: { STANDARD: [80, 120, 100] },
  }),
  participationPricingTypes: ["STANDARD", "SURPLUS"],
  mealPricingTypes: ["STANDARD"],
};

afterEach(cleanup);

describe("a column nobody is charged for", () => {
  it("drops the daily rate when no age and no tier has one", () => {
    open(KOLINACKA);
    expect(table(0)!.columns).toEqual([M.pricePerNightShort]);
  });

  it("keeps both columns as soon as a single cell has a daily rate", () => {
    open({
      ...KOLINACKA,
      pricingRules: stayRules({ AGE_15_PLUS: { STANDARD: [150, 200], SURPLUS: [0, 300] } }),
    });
    expect(table(0)!.columns).toEqual([M.dailyRateShort, M.pricePerNightShort]);
  });

  it("drops a meal the whole price list feeds for free", () => {
    open({
      ...KOLINACKA,
      mealPricingRules: mealRules({
        AGE_4_7: { STANDARD: [40, 60, 0] },
        AGE_8_14: { STANDARD: [40, 60, 0] },
        AGE_15_PLUS: { STANDARD: [80, 120, 0] },
      }),
    });
    expect(table(1)!.columns).toEqual([M.breakfast, M.lunch]);
  });
});

describe("a category nobody is charged for", () => {
  it("lists only the ages the stay actually charges", () => {
    open(KOLINACKA);
    const t0 = table(0)!;
    expect(Object.keys(t0.rows)).toEqual([
      tier(M.age.age15, M.tier.standard),
      tier(M.age.age15, M.tier.surplus),
    ]);
    expect(t0.rows[tier(M.age.age15, M.tier.standard)]).toEqual(["200 CZK"]);
    expect(t0.rows[tier(M.age.age15, M.tier.surplus)]).toEqual(["300 CZK"]);
  });

  it("leaves out the toddlers who eat free but keeps every age that pays", () => {
    open(KOLINACKA);
    const t1 = table(1)!;
    expect(Object.keys(t1.rows)).toEqual([M.age.age47, M.age.age814, M.age.age15]);
    expect(t1.rows[M.age.age15]).toEqual(["80 CZK", "120 CZK", "100 CZK"]);
  });

  // The failure this replaces, one level down: dropping just the free ROW would
  // read as "standard is missing" rather than "standard is free".
  it("keeps a category's free row when another of its tiers is priced", () => {
    open({
      ...KOLINACKA,
      participationPricingTypes: [...TIERS],
      pricingRules: stayRules({
        AGE_15_PLUS: { STANDARD: [0, 0], SUPPORTED: [0, 0], SURPLUS: [0, 300] },
      }),
    });
    const t0 = table(0)!;
    expect(Object.keys(t0.rows)).toEqual([
      tier(M.age.age15, M.tier.standard),
      tier(M.age.age15, M.tier.supported),
      tier(M.age.age15, M.tier.surplus),
    ]);
    expect(t0.rows[tier(M.age.age15, M.tier.standard)]).toEqual(["0 CZK"]);
  });

  // A tier the event does NOT offer must not keep a category alive — each table
  // reads its own half's set (invariant 22).
  it("ignores a priced tier the event does not offer", () => {
    open({
      ...KOLINACKA,
      participationPricingTypes: ["STANDARD"],
      pricingRules: stayRules({
        AGE_8_14: { SURPLUS: [0, 120] },
        AGE_15_PLUS: { STANDARD: [0, 200] },
      }),
    });
    expect(Object.keys(table(0)!.rows)).toEqual([M.age.age15]);
  });
});

describe("an event that charges normally is untouched", () => {
  const full = {
    pricingRules: stayRules({
      AGE_4_7: { STANDARD: [50, 40], SUPPORTED: [30, 20], SURPLUS: [70, 60] },
      AGE_8_14: { STANDARD: [100, 80], SUPPORTED: [60, 50], SURPLUS: [150, 120] },
      AGE_15_PLUS: { STANDARD: [200, 150], SUPPORTED: [100, 100], SURPLUS: [300, 200] },
    }),
    mealPricingRules: mealRules({
      AGE_4_7: { STANDARD: [40, 60, 50], SUPPORTED: [40, 60, 50], SURPLUS: [40, 60, 50] },
      AGE_8_14: { STANDARD: [60, 90, 90], SUPPORTED: [40, 60, 60], SURPLUS: [90, 130, 130] },
      AGE_15_PLUS: { STANDARD: [80, 120, 120], SUPPORTED: [50, 80, 80], SURPLUS: [110, 160, 160] },
    }),
  };

  it("keeps every column and every paid category, split by tier", () => {
    open(full);
    const t0 = table(0)!;
    expect(t0.columns).toEqual([M.dailyRateShort, M.pricePerNightShort]);
    expect(Object.keys(t0.rows)).toEqual([
      tier(M.age.age47, M.tier.standard),
      tier(M.age.age47, M.tier.supported),
      tier(M.age.age47, M.tier.surplus),
      tier(M.age.age814, M.tier.standard),
      tier(M.age.age814, M.tier.supported),
      tier(M.age.age814, M.tier.surplus),
      tier(M.age.age15, M.tier.standard),
      tier(M.age.age15, M.tier.supported),
      tier(M.age.age15, M.tier.surplus),
    ]);
    expect(t0.rows[tier(M.age.age15, M.tier.supported)]).toEqual(["100 CZK", "100 CZK"]);
  });

  // The pre-existing collapse rule, which the trimming must not disturb: a
  // category whose offered tiers all agree is one row labelled by age alone.
  it("still collapses a category whose tiers all agree", () => {
    open(full);
    expect(table(1)!.rows[M.age.age47]).toEqual(["40 CZK", "60 CZK", "50 CZK"]);
  });
});

describe("when there is nothing at all to charge", () => {
  it("says so in words instead of rendering an empty grid", () => {
    open({ participationPricingTypes: ["STANDARD"], mealPricingTypes: ["STANDARD"] });
    expect(document.querySelectorAll("table")).toHaveLength(0);
    expect(document.body.textContent).toContain(M.free);
  });
});
