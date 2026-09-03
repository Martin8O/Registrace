// @vitest-environment jsdom
//
// The public registration form, rendered for real. Everything here was proven
// only by M41's one-off click-through before M42; the price list in the fixture
// is the live demo event's (26009), so the numbers below are literally the ones
// hand-checked on production.
//
// Messages come from the REAL locale file, so a missing key fails here instead
// of rendering as a raw key in front of a registrant.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import cs from "@/locales/cs.json";
import RegistrationForm from "./RegistrationForm";

const dates = [
  { id: "d1", date: "2026-09-11", label_cs: "Pátek 11.9.", label_en: "Fri 11.9.", sortOrder: 0 },
  { id: "d2", date: "2026-09-12", label_cs: "Sobota 12.9.", label_en: "Sat 12.9.", sortOrder: 1 },
  { id: "d3", date: "2026-09-13", label_cs: "Neděle 13.9.", label_en: "Sun 13.9.", sortOrder: 2 },
];

const meals = [
  { id: "m_b2", eventDateId: "d2", mealType: "BREAKFAST" as const, price: 80, isClosed: false },
  { id: "m_l2", eventDateId: "d2", mealType: "LUNCH" as const, price: 120, isClosed: false },
  { id: "m_d2", eventDateId: "d2", mealType: "DINNER" as const, price: 120, isClosed: true },
];

const rule = (ageCategory: string, pricingType: string, dailyRate: number, nightRate: number) => ({
  id: `${ageCategory}-${pricingType}`,
  ageCategory,
  pricingType,
  dailyRate,
  nightRate,
  morningArrivalDiscount: 30,
  afternoonArrivalDiscount: 50,
  eveningArrivalDiscount: 80,
  earlyDepartureDiscount: 50,
});

const pricingRules = [
  rule("AGE_15_PLUS", "STANDARD", 200, 150),
  rule("AGE_15_PLUS", "SUPPORTED", 100, 100),
  rule("AGE_15_PLUS", "SURPLUS", 300, 200),
  rule("AGE_8_14", "STANDARD", 100, 80),
  rule("AGE_8_14", "SUPPORTED", 60, 50),
  rule("AGE_8_14", "SURPLUS", 150, 120),
];

// The 26009 meal price list, for the two ages the tests touch.
const MEAL_PRICES: Record<string, Record<string, [number, number, number]>> = {
  AGE_15_PLUS: { STANDARD: [80, 120, 120], SUPPORTED: [50, 80, 80], SURPLUS: [110, 160, 160] },
  AGE_8_14: { STANDARD: [60, 90, 90], SUPPORTED: [40, 60, 60], SURPLUS: [90, 130, 130] },
};
const mealPricingRules = Object.entries(MEAL_PRICES).flatMap(([ageCategory, byTier]) =>
  Object.entries(byTier).flatMap(([pricingType, [b, l, d]]) => [
    { id: `${ageCategory}-${pricingType}-B`, mealType: "BREAKFAST" as const, ageCategory, pricingType, price: b },
    { id: `${ageCategory}-${pricingType}-L`, mealType: "LUNCH" as const, ageCategory, pricingType, price: l },
    { id: `${ageCategory}-${pricingType}-D`, mealType: "DINNER" as const, ageCategory, pricingType, price: d },
  ]),
);

const centers = [{ id: "c1", name_cs: "Těnovice", name_en: "Tenovice" }];
const ALL = ["STANDARD", "SUPPORTED", "SURPLUS"];

function renderForm(over: { participationPricingTypes?: string[]; mealPricingTypes?: string[] } = {}) {
  return render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <RegistrationForm
        eventId="e1"
        dates={dates}
        meals={meals}
        centers={centers}
        pricingRules={pricingRules}
        mealPricingRules={mealPricingRules}
        participationPricingTypes={over.participationPricingTypes ?? ALL}
        mealPricingTypes={over.mealPricingTypes ?? ALL}
        mealRegistrationDeadline={null}
      />
    </NextIntlClientProvider>,
  );
}

const radios = (name: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map((e) => e.value);
const click = (id: string) => fireEvent.click(document.getElementById(id)!);
const labelOf = (mealId: string) =>
  document.querySelector(`label[for="meal-0-${mealId}"]`)?.textContent?.replace(/\s+/g, " ").trim();

beforeEach(() => {
  // The success panel scrolls itself into view; jsdom has no scrollTo and would
  // print a "Not implemented" stack for every submit.
  vi.stubGlobal("scrollTo", vi.fn());
  // calculate-price is debounced and fired on every edit; it never drives what
  // these tests assert (the meal labels are priced client-side from the list).
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ participants: [], totalPrice: 0 }),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── The four tier-offer variants, from M41's matrix ──────────────────────────

describe("which tier selectors the form renders", () => {
  it("three tiers on both halves → both selectors", () => {
    renderForm();
    expect(radios("participants.0.pricingType")).toEqual(ALL);
    expect(radios("participants.0.mealPricingType")).toEqual(ALL);
  });

  it("one tier on both halves → NO tier selector at all", () => {
    renderForm({ participationPricingTypes: ["STANDARD"], mealPricingTypes: ["STANDARD"] });
    expect(radios("participants.0.pricingType")).toEqual([]);
    expect(radios("participants.0.mealPricingType")).toEqual([]);
    expect(screen.queryByText(cs.form.price_type_participation)).not.toBeTruthy();
    expect(screen.queryByText(cs.form.price_type_meals)).not.toBeTruthy();
  });

  it("three participation tiers, one meal tier → only the participation selector", () => {
    renderForm({ mealPricingTypes: ["STANDARD"] });
    expect(radios("participants.0.pricingType")).toEqual(ALL);
    expect(radios("participants.0.mealPricingType")).toEqual([]);
  });

  // The variant that existed nowhere until M41 created an event for it.
  it("one participation tier, three meal tiers → only the meal selector", () => {
    renderForm({ participationPricingTypes: ["STANDARD"] });
    expect(radios("participants.0.pricingType")).toEqual([]);
    expect(radios("participants.0.mealPricingType")).toEqual(ALL);
  });

  it("each half offers only ITS own set", () => {
    renderForm({ participationPricingTypes: ["STANDARD", "SURPLUS"], mealPricingTypes: ALL });
    expect(radios("participants.0.pricingType")).toEqual(["STANDARD", "SURPLUS"]);
    expect(radios("participants.0.mealPricingType")).toEqual(ALL);
  });
});

// ─── Meal labels price from the MEAL tier, never the stay tier ────────────────
// The bug this guards against would be invisible: the label and the subtotal
// under it would simply disagree, and only by a hand calculation from the price
// list would anyone notice.

describe("meal labels are priced by the meal tier", () => {
  const openStay = () => {
    click("arrivalDateId-d1");
    click("arrivalTime-MORNING");
    click("departureDateId-d3");
    click("participants.0.ageCategory-AGE_15_PLUS");
  };

  it("15+ on the standard meal tier → 80 / 120", () => {
    renderForm();
    openStay();
    expect(labelOf("m_b2")).toContain("80 CZK");
    expect(labelOf("m_l2")).toContain("120 CZK");
  });

  it("switching the MEAL tier repaints them (supported → 50 / 80)", () => {
    renderForm();
    openStay();
    click("participants.0.mealPricingType-SUPPORTED");
    expect(labelOf("m_b2")).toContain("50 CZK");
    expect(labelOf("m_l2")).toContain("80 CZK");
  });

  it("switching the STAY tier does NOT touch them", () => {
    renderForm();
    openStay();
    click("participants.0.mealPricingType-SUPPORTED");
    const before = [labelOf("m_b2"), labelOf("m_l2")];
    click("participants.0.pricingType-SURPLUS");
    expect([labelOf("m_b2"), labelOf("m_l2")]).toEqual(before);
  });

  it("changing the AGE repaints them too (8–14 surplus → 90 / 130)", () => {
    renderForm();
    openStay();
    click("participants.0.mealPricingType-SURPLUS");
    click("participants.0.ageCategory-AGE_8_14");
    expect(labelOf("m_b2")).toContain("90 CZK");
    expect(labelOf("m_l2")).toContain("130 CZK");
  });

  // A closed slot is one the event does not serve at all. It used to render as a
  // priced pill that could not be clicked, which is an option nobody has — the
  // engine and the submit service both refuse a closed meal id anyway.
  it("a closed meal is not rendered at all", () => {
    renderForm();
    openStay();
    expect(document.getElementById("meal-0-m_d2")).toBeNull();
    expect(document.getElementById("meal-0-m_b2")).toBeTruthy();
    expect(document.getElementById("meal-0-m_l2")).toBeTruthy();
  });
});

// ─── What an untouched form already says (the stay defaults) ────────────────
// The two dates cannot be guessed and the resolver refuses a submit without them.
// Everything else about the stay is pre-set to the ordinary BDC weekend, because
// those fields are ones a registrant skips: an untouched form used to submit "no
// accommodation", which is a real choice nobody made.

describe("the stay a form arrives with", () => {
  const checked = (name: string) =>
    document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? null;

  it("pre-selects a morning arrival, an evening departure and a bed", () => {
    renderForm();
    expect(checked("arrivalTime")).toBe("MORNING");
    expect(checked("earlyDeparture")).toBe("NONE");
    expect((document.getElementById("accommodation-yes") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("accommodation-no") as HTMLInputElement).checked).toBe(false);
  });

  it("leaves both dates for the registrant — nothing can guess them", () => {
    renderForm();
    expect(checked("arrivalDateId")).toBeNull();
    expect(checked("departureDateId")).toBeNull();
  });

  // The morning default is also what leaves the arrival day's meals on offer:
  // with no arrival time at all, breakfast and lunch of day one were hidden until
  // the registrant happened to pick one.
  it("offers the arrival day's full meal list without a single extra click", () => {
    renderForm();
    click("arrivalDateId-d2");
    click("departureDateId-d3");
    expect(document.getElementById("meal-0-m_b2")).toBeTruthy();
    expect(document.getElementById("meal-0-m_l2")).toBeTruthy();
  });

  it("still lets the registrant say they are not sleeping there", () => {
    renderForm();
    click("accommodation-no");
    expect((document.getElementById("accommodation-no") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("accommodation-yes") as HTMLInputElement).checked).toBe(false);
  });
});

// ─── What the form sends ──────────────────────────────────────────────────────

describe("the outgoing payload", () => {
  const lastCalcBody = () => {
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("calculate-price"),
    );
    return JSON.parse((calls.at(-1)![1] as { body: string }).body);
  };

  // The trap M41 went looking for: if the half with no selector were simply
  // OMITTED, the service would fall back to this person's STAY tier — absent
  // from the meal price list, and a missing combination prices at 0 (invariant
  // 21). The meal would be free. Both tiers must be sent explicitly.
  it("sends BOTH tiers explicitly even when only one selector is rendered", async () => {
    renderForm({ mealPricingTypes: ["STANDARD"] });
    click("arrivalDateId-d1");
    click("arrivalTime-MORNING");
    click("departureDateId-d3");
    click("participants.0.ageCategory-AGE_15_PLUS");
    click("participants.0.pricingType-SURPLUS");

    await waitFor(() => expect(lastCalcBody().participants[0]).toMatchObject({
      pricingType: "SURPLUS",
      mealPricingType: "STANDARD",
    }));
  });

  // The defaults are only worth anything if they are what actually gets sent.
  it("carries the pre-selected stay even when the registrant only picks dates", async () => {
    renderForm();
    click("arrivalDateId-d1");
    click("departureDateId-d3");

    await waitFor(() =>
      expect(lastCalcBody()).toMatchObject({
        arrivalTime: "MORNING",
        earlyDeparture: "NONE",
        hasAccommodation: true,
      }),
    );
  });

  it("does the same in the mirror variant (no participation selector)", async () => {
    renderForm({ participationPricingTypes: ["STANDARD"] });
    click("arrivalDateId-d1");
    click("arrivalTime-MORNING");
    click("departureDateId-d3");
    click("participants.0.ageCategory-AGE_15_PLUS");
    click("participants.0.mealPricingType-SURPLUS");

    await waitFor(() => expect(lastCalcBody().participants[0]).toMatchObject({
      pricingType: "STANDARD",
      mealPricingType: "SURPLUS",
    }));
  });
});

// ─── The success panel (M42) ──────────────────────────────────────────────────
// Before M42 it said only "registration submitted": no number to quote, and no
// word about the email. Since a failed send never rolls the registration back
// (invariant 6), that left a Resend outage completely silent to the registrant.

describe("the panel shown after a successful submit", () => {
  // Fill the form to the point the resolver accepts it, then submit.
  async function submitValidForm(response: Record<string, unknown>) {
    const submit = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("submit")) return submit(url, init);
      return Promise.resolve({ ok: true, json: async () => ({ participants: [], totalPrice: 0 }) });
    }));

    renderForm();
    click("arrivalDateId-d1");
    click("arrivalTime-MORNING");
    click("departureDateId-d3");
    click("earlyDeparture-NONE");
    click("accommodation-yes");
    click("participants.0.ageCategory-AGE_15_PLUS");
    click("participants.0.mealType-MEAT");
    fireEvent.change(document.getElementById("fullName-0")!, { target: { value: "Jan Novák" } });
    fireEvent.change(document.getElementById("email")!, { target: { value: "jan@example.cz" } });
    fireEvent.click(document.querySelector('input[name="gdprConsent"]')!);

    fireEvent.click(screen.getByRole("button", { name: cs.form.register }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    return submit;
  }

  it("shows the registration number and says where the confirmation went", async () => {
    await submitValidForm({ registrationNumber: "260090009", confirmationSent: true });

    await waitFor(() => expect(screen.getByText(cs.form.registration_success)).toBeTruthy());
    expect(screen.getByText("260090009")).toBeTruthy();
    expect(screen.getByText(cs.form.success_number_label)).toBeTruthy();
    expect(screen.getByText(/jan@example\.cz/)).toBeTruthy();
  });

  // Invariant 6: the registration stands, so this is the only place the person
  // can learn no email is coming — and the number becomes the only handle they
  // have on it.
  it("says the confirmation failed rather than promising an email that will not arrive", async () => {
    await submitValidForm({ registrationNumber: "260090009", confirmationSent: false });

    await waitFor(() => expect(screen.getByText(cs.form.success_email_failed)).toBeTruthy());
    expect(screen.getByText("260090009")).toBeTruthy();
    expect(screen.queryByText(/jan@example\.cz/)).not.toBeTruthy();
  });

  // The honeypot's fake success carries no number, and the panel must stay byte
  // for byte what a bot saw before this block existed — otherwise the extra line
  // is a tell that the trap fired.
  it("with no number (the honeypot's fake success) shows nothing beyond the plain line", async () => {
    await submitValidForm({ registrationNumber: null, confirmationSent: false });

    await waitFor(() => expect(screen.getByText(cs.form.registration_success)).toBeTruthy());
    expect(screen.queryByText(cs.form.success_number_label)).not.toBeTruthy();
    expect(screen.queryByText(cs.form.success_email_failed)).not.toBeTruthy();
  });

  it("still confirms when the response body cannot be read at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("submit")) {
        return Promise.resolve({ ok: true, json: async () => { throw new Error("no body") } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ participants: [], totalPrice: 0 }) });
    }));
    renderForm();
    click("arrivalDateId-d1");
    click("arrivalTime-MORNING");
    click("departureDateId-d3");
    click("participants.0.ageCategory-AGE_15_PLUS");
    click("participants.0.mealType-MEAT");
    fireEvent.change(document.getElementById("fullName-0")!, { target: { value: "Jan Novák" } });
    fireEvent.change(document.getElementById("email")!, { target: { value: "jan@example.cz" } });
    fireEvent.click(document.querySelector('input[name="gdprConsent"]')!);
    fireEvent.click(screen.getByRole("button", { name: cs.form.register }));

    await waitFor(() => expect(screen.getByText(cs.form.registration_success)).toBeTruthy());
    expect(screen.queryByText(cs.form.success_number_label)).not.toBeTruthy();
  });
});
