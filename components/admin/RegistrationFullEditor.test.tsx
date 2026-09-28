// @vitest-environment jsdom
//
// The admin FULL registration editor (M50b), rendered for real with the REAL
// locale file (a missing key fails here, not in front of an admin). Replaces the
// narrower tier editor's suite and keeps its guarantees: the tier-select variants,
// the stranded tier, a save that sends choices and never amounts, a refusal that
// says why, and the resend rules for a cancelled registration (M47).
// The server is mocked at fetch — what is pinned is what this screen shows and
// what it sends; the pricing itself is the server's (modules/registrations).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import cs from "@/locales/cs.json";
import RegistrationFullEditor, { type FullEditorData, type FullEditorParticipant } from "./RegistrationFullEditor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const RD = cs.admin.registrationDetail;
const ALL = ["STANDARD", "SUPPORTED", "SURPLUS"];

// 3 days × breakfast/lunch/dinner; day 2's dinner is closed.
const DATES = [1, 2, 3].map((n) => ({
  id: `d${n}`, date: `2026-05-0${n}`, label_cs: `Den ${n}`, label_en: `Day ${n}`, sortOrder: n,
}));
const MEALS = DATES.flatMap((d, i) =>
  (["BREAKFAST", "LUNCH", "DINNER"] as const).map((mealType) => ({
    id: `${mealType[0]!.toLowerCase()}${i + 1}`,
    eventDateId: d.id, mealType, price: 999,
    isClosed: d.id === "d2" && mealType === "DINNER",
  })),
);
const MEAL_RULES = [
  { id: "r1", mealType: "LUNCH", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", price: 120 },
  { id: "r2", mealType: "LUNCH", ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", price: 90 },
  { id: "r3", mealType: "BREAKFAST", ageCategory: "AGE_15_PLUS", pricingType: "SUPPORTED", price: 55 },
];

const ADULT: FullEditorParticipant = {
  id: "p1", fullName: "Jan Novák", ageCategory: "AGE_15_PLUS", pricingType: "SURPLUS",
  mealPricingType: "SUPPORTED", mealType: "MEAT", mealIds: ["b1", "l1"], totalPrice: 445,
};
const CHILD: FullEditorParticipant = {
  id: "p2", fullName: "Eva Malá", ageCategory: "AGE_8_14", pricingType: "SUPPORTED",
  mealPricingType: "SURPLUS", mealType: "VEGETARIAN", mealIds: ["l1"], totalPrice: 180,
};

function data(over: Partial<Omit<FullEditorData, "event">> & { event?: Partial<FullEditorData["event"]> } = {}): FullEditorData {
  const { event, ...rest } = over;
  return {
    registrationId: "r1", registrationNumber: "260090009", updatedAt: "2026-09-20T10:00:00.000Z",
    centerId: "c1", status: "REGISTERED", totalPrice: 625, hasAccommodation: true,
    arrivalDateId: "d1", arrivalTime: "MORNING", departureDateId: "d3", earlyDeparture: "NONE",
    participants: [ADULT, CHILD],
    ...rest,
    event: {
      dates: DATES, meals: MEALS as never, mealPricingRules: MEAL_RULES as never,
      participationPricingTypes: ALL, mealPricingTypes: ALL, mealDeadline: null,
      ...event,
    },
  };
}

function renderEditor(d: FullEditorData = data()) {
  return render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <RegistrationFullEditor data={d} numberLabel="Číslo registrace" pricingButton={null}>
        <div>summary</div>
      </RegistrationFullEditor>
    </NextIntlClientProvider>,
  );
}

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;
const calls = (suffix: string) => fetchMock().mock.calls.filter((c) => String(c[0]).endsWith(suffix));
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const radio = (id: string) => byId<HTMLInputElement>(id)!;
const meal = (pKey: string, mealId: string) => byId<HTMLInputElement>(`meal-${pKey}-${mealId}`);
const saveButton = () => screen.getByText(RD.save).closest("button")!;
const resendButton = () => screen.getByText(RD.resend).closest("button")!;
const statusSelect = () => screen.getByLabelText(RD.status) as HTMLSelectElement;
const optionsOf = (el: HTMLSelectElement) => [...el.options].map((o) => o.value);

// The preview endpoint answers with a total derived from the body, so a test can
// tell which request produced what is on screen.
function previewReturns(total: number, subtotals: number[]) {
  fetchMock().mockImplementation(async (url: string) =>
    String(url).endsWith("/calculate-price")
      ? { ok: true, json: async () => ({ data: { totalPrice: total, participants: subtotals.map((s) => ({ subtotal: s })), mealDeadlinePassed: false } }) }
      : { ok: true, json: async () => ({ data: { id: "r1" } }) },
  );
}

beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn());
  previewReturns(625, [445, 180]);
});

// The price is always the server's: one request on open, then one per settled
// change. Tests that save wait for it, as the save button does.
const priced = () => waitFor(() => expect(screen.getByTestId("total-price").className).not.toContain("opacity-50"), { timeout: 2000 });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── It opens exactly as the registrant submitted it ──────────────────────────

describe("the stored registration, shown as it is", () => {
  it("the stay, accommodation, names, ages, diets and ticked meals are the stored ones", () => {
    renderEditor();
    expect(radio("arrivalDateId-d1").checked).toBe(true);
    expect(radio("arrivalTime-MORNING").checked).toBe(true);
    expect(radio("departureDateId-d3").checked).toBe(true);
    expect(radio("earlyDeparture-NONE").checked).toBe(true);
    expect(radio("hasAccommodation-yes").checked).toBe(true);
    expect(byId<HTMLInputElement>("fullName-p1")!.value).toBe("Jan Novák");
    expect(radio("age-p2-AGE_8_14").checked).toBe(true);
    expect(radio("diet-p2-VEGETARIAN").checked).toBe(true);
    expect(meal("p1", "b1")!.checked).toBe(true);
    expect(meal("p1", "l1")!.checked).toBe(true);
    expect(meal("p1", "d1")!.checked).toBe(false);
    expect(meal("p2", "l1")!.checked).toBe(true);
  });

  it("shows the stored prices greyed, asks the server once on open, and typing a name asks nothing more", async () => {
    renderEditor();
    expect(screen.getByTestId("total-price").textContent).toBe("625 CZK");
    expect(screen.getByTestId("total-price").className).toContain("opacity-50");
    expect(screen.getByTestId("subtotal-0").textContent).toBe("445 CZK");
    await priced();
    expect(calls("/calculate-price")).toHaveLength(1);
    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    await new Promise((r) => setTimeout(r, 700));
    expect(calls("/calculate-price")).toHaveLength(1);
  });

  it("a stored total the engine no longer agrees with: the screen shows what the save will write", async () => {
    // The live test registration 260070002 stores 550 where today's engine says 850.
    previewReturns(850, [850]);
    renderEditor(data({ status: "PAID", totalPrice: 550, participants: [{ ...ADULT, totalPrice: 550 }] }));
    await waitFor(() => expect(screen.getByTestId("total-price").textContent).toBe("850 CZK"), { timeout: 2000 });
    // …and a PAID registration is not paid in full at that price (D4).
    expect(statusSelect().value).toBe("REGISTERED");
  });

  it("a failed price request can be sent again", async () => {
    fetchMock().mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    renderEditor();
    await waitFor(() => expect(screen.getByText(RD.priceFailed)).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByText(RD.priceRetry));
    await priced();
    expect(screen.queryByText(RD.priceFailed)).toBeNull();
    expect(calls("/calculate-price")).toHaveLength(2);
  });

  it("prices each meal pill for THAT person at their MEAL tier (not the stay tier)", () => {
    renderEditor();
    // Adult stays SURPLUS but eats SUPPORTED → lunch 90, never STANDARD 120 or the flat 999.
    expect(document.querySelector('label[for="meal-p1-l1"]')!.textContent).toContain("90 CZK");
  });

  it("never offers a meal the event closed for that day", () => {
    renderEditor();
    expect(meal("p1", "d2")).toBeNull();
    expect(meal("p1", "l2")).not.toBeNull();
  });

  it("a stored meal outside the stay is shown ticked and flagged, and blocks the save until unticked", () => {
    // Stay d2→d3, but b1 (day 1) is stored — the 24 seeded demo registrations look like this.
    renderEditor(data({ arrivalDateId: "d2", participants: [{ ...ADULT, mealIds: ["b1", "l2"] }] }));
    expect(meal("p1", "b1")!.checked).toBe(true);
    expect(document.querySelector('label[for="meal-p1-b1"]')!.getAttribute("data-flagged")).toBe("true");
    expect(screen.getByText(RD.outsideStayNote)).toBeTruthy();

    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(meal("p1", "b1")!);
    expect(meal("p1", "b1")).toBeNull(); // unticked, and not a slot of this stay
    expect(screen.queryByText(RD.outsideStayNote)).toBeNull();
  });

  it("after the meal deadline: a notice, and the meals stay editable", () => {
    renderEditor(data({ event: { mealDeadline: "2020-01-01T00:00:00.000Z" } }));
    expect(screen.getByText(RD.deadlinePassed)).toBeTruthy();
    fireEvent.click(meal("p1", "d1")!);
    expect(meal("p1", "d1")!.checked).toBe(true);
  });
});

// ─── Tier selects (the old editor's guarantees, kept) ─────────────────────────

describe("tier selects", () => {
  it("three tiers on both halves → both selects, prefilled with the stored tiers", () => {
    renderEditor();
    expect(byId<HTMLSelectElement>("tier-participation-p1")!.value).toBe("SURPLUS");
    expect(byId<HTMLSelectElement>("tier-meal-p1")!.value).toBe("SUPPORTED");
  });

  it("one tier on both halves → no select at all", () => {
    renderEditor(data({
      participants: [{ ...ADULT, pricingType: "STANDARD", mealPricingType: "STANDARD" }],
      event: { participationPricingTypes: ["STANDARD"], mealPricingTypes: ["STANDARD"] },
    }));
    expect(byId("tier-participation-p1")).toBeNull();
    expect(byId("tier-meal-p1")).toBeNull();
  });

  it("each half lists only its own set; an empty set reads as all three", () => {
    renderEditor(data({
      participants: [{ ...ADULT, pricingType: "STANDARD" }],
      event: { participationPricingTypes: ["STANDARD", "SUPPORTED"], mealPricingTypes: [] },
    }));
    expect(optionsOf(byId<HTMLSelectElement>("tier-participation-p1")!)).toEqual(["STANDARD", "SUPPORTED"]);
    expect(optionsOf(byId<HTMLSelectElement>("tier-meal-p1")!)).toEqual(ALL);
  });

  it("a stranded tier stays visible and selected, even on a single-tier event", () => {
    renderEditor(data({
      participants: [{ ...ADULT, pricingType: "SURPLUS", mealPricingType: "STANDARD" }],
      event: { participationPricingTypes: ["STANDARD"], mealPricingTypes: ["STANDARD"] },
    }));
    const el = byId<HTMLSelectElement>("tier-participation-p1")!;
    expect(el.value).toBe("SURPLUS");
    expect(optionsOf(el)).toEqual(["SURPLUS", "STANDARD"]);
    expect(byId("tier-meal-p1")).toBeNull();
  });
});

// ─── The stay ─────────────────────────────────────────────────────────────────

describe("the stay", () => {
  it("disables the combinations the server would refuse", () => {
    renderEditor(data({ arrivalDateId: "d2", participants: [{ ...ADULT, mealIds: [] }] }));
    expect(radio("departureDateId-d1").disabled).toBe(true); // before arrival
    fireEvent.click(radio("departureDateId-d2"));
    expect(radio("arrivalTime-EVENING").disabled).toBe(true); // same-day evening
    fireEvent.click(radio("arrivalTime-AFTERNOON"));
    expect(radio("earlyDeparture-AFTER_BREAKFAST").disabled).toBe(true); // same day, not morning
  });

  it("same day, leaving after breakfast: only the morning arrival stays pickable", () => {
    renderEditor(data({ departureDateId: "d1", earlyDeparture: "AFTER_BREAKFAST", participants: [{ ...ADULT, mealIds: ["b1"] }] }));
    expect(radio("arrivalTime-MORNING").disabled).toBe(false);
    expect(radio("arrivalTime-AFTERNOON").disabled).toBe(true);
    expect(radio("arrivalTime-EVENING").disabled).toBe(true);
  });

  it("arriving a day later drops everyone's first-day meals, in the same click", () => {
    renderEditor();
    fireEvent.click(radio("arrivalDateId-d2"));
    expect(meal("p1", "b1")).toBeNull();
    expect(meal("p1", "l1")).toBeNull();
    expect(meal("p2", "l1")).toBeNull();
    expect(meal("p1", "l2")).not.toBeNull();
  });

  it("an impossible stay is explained, not priced, and cannot be saved — and keeps the meals", async () => {
    // Arrival pills are never disabled (the admin may be about to move the
    // departure too), so arriving after the stored departure is reachable.
    renderEditor(data({ departureDateId: "d2" }));
    fireEvent.click(radio("arrivalDateId-d3"));
    expect(screen.getByText(RD.stayInvalid.departure_before_arrival)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(meal("p1", "b1")!.checked).toBe(true); // nothing dropped while still choosing
    await new Promise((r) => setTimeout(r, 700));
    expect(calls("/calculate-price")).toHaveLength(1); // the one on open, none for the impossible stay
  });
});

// ─── People ───────────────────────────────────────────────────────────────────

describe("people", () => {
  it("the last participant cannot be removed, and the reason is shown", () => {
    renderEditor(data({ participants: [ADULT] }));
    expect(screen.getByText(RD.removeParticipant).closest("button")!.disabled).toBe(true);
    expect(screen.getAllByText(RD.lastParticipantNote).length).toBeGreaterThan(0);
  });

  it("no more than ten people", () => {
    renderEditor();
    const add = screen.getByText(RD.addParticipant).closest("button")!;
    for (let n = 0; n < 8; n++) fireEvent.click(add);
    expect(document.querySelectorAll('[data-testid^="participant-"]')).toHaveLength(10);
    expect(add.disabled).toBe(true);
    expect(screen.getByText(RD.maxParticipantsNote)).toBeTruthy();
  });
});

// ─── The live price ───────────────────────────────────────────────────────────

describe("the live price", () => {
  it("asks the server once the change settles, sends choices only, and shows its answer", async () => {
    renderEditor();
    await priced(); // the price on open is the stored one
    previewReturns(505, [325, 180]);
    fireEvent.change(byId("tier-participation-p1")!, { target: { value: "STANDARD" } });

    await waitFor(() => expect(screen.getByTestId("total-price").textContent).toBe("505 CZK"), { timeout: 2000 });
    const [url, init] = calls("/calculate-price").at(-1)!; // the first one is the price on open
    expect(url).toBe("/api/admin/registrations/r1/calculate-price");
    const body = JSON.parse(init.body as string);
    expect(body.participants[0]).toMatchObject({ id: "p1", pricingType: "STANDARD", mealPricingType: "SUPPORTED" });
    expect(JSON.stringify(body)).not.toMatch(/price"|Price"|totalPrice|amount|email/);
    expect(screen.getByTestId("subtotal-0").textContent).toBe("325 CZK");
  });
});

// ─── D4: a paid registration whose price changes ──────────────────────────────

describe("a PAID registration", () => {
  it("drops to REGISTERED when the price changes, says why, and saves it so", async () => {
    renderEditor(data({ status: "PAID" }));
    await priced(); // the price on open is the stored one
    previewReturns(505, [325, 180]);
    fireEvent.change(byId("tier-participation-p1")!, { target: { value: "STANDARD" } });

    await waitFor(() => expect(statusSelect().value).toBe("REGISTERED"), { timeout: 2000 });
    expect(screen.getByText(RD.paidSwitched)).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(calls("/full")).toHaveLength(1));
    expect(JSON.parse(calls("/full")[0]![1].body as string).status).toBe("REGISTERED");
  });

  it("stays PAID when only a name changes — nothing that prices moved", async () => {
    renderEditor(data({ status: "PAID" }));
    await priced();
    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    expect(statusSelect().value).toBe("PAID");
    fireEvent.click(saveButton());
    await waitFor(() => expect(calls("/full")).toHaveLength(1));
    expect(JSON.parse(calls("/full")[0]![1].body as string).status).toBe("PAID");
  });

  it("the admin's own pick wins: PAID chosen after the switch is saved as PAID", async () => {
    renderEditor(data({ status: "PAID" }));
    await priced(); // the price on open is the stored one
    previewReturns(505, [325, 180]);
    fireEvent.change(byId("tier-participation-p1")!, { target: { value: "STANDARD" } });
    await waitFor(() => expect(statusSelect().value).toBe("REGISTERED"), { timeout: 2000 });

    fireEvent.change(statusSelect(), { target: { value: "PAID" } });
    expect(screen.queryByText(RD.paidSwitched)).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(calls("/full")).toHaveLength(1));
    expect(JSON.parse(calls("/full")[0]![1].body as string).status).toBe("PAID");
  });

  it("…but a PAID picked at one price does not hold for a price changed afterwards", async () => {
    renderEditor(data({ status: "PAID" }));
    await priced(); // the price on open is the stored one
    previewReturns(505, [325, 180]);
    fireEvent.change(byId("tier-participation-p1")!, { target: { value: "STANDARD" } });
    await waitFor(() => expect(statusSelect().value).toBe("REGISTERED"), { timeout: 2000 });
    fireEvent.change(statusSelect(), { target: { value: "PAID" } });

    previewReturns(595, [415, 180]);
    fireEvent.click(meal("p1", "d1")!);
    await waitFor(() => expect(statusSelect().value).toBe("REGISTERED"), { timeout: 2000 });
    expect(screen.getByText(RD.paidSwitched)).toBeTruthy();
  });
});

// ─── Saving ───────────────────────────────────────────────────────────────────

describe("saving", () => {
  it("is disabled until something changed", () => {
    renderEditor();
    expect(saveButton().disabled).toBe(true);
  });

  it("sends the whole state with the loaded updatedAt — ids for the stored people, none for a new one, no e-mail, no amounts", async () => {
    renderEditor();
    await priced(); // the price on open is the stored one
    previewReturns(805, [445, 180, 180]);
    fireEvent.click(screen.getByText(RD.addParticipant));
    fireEvent.change(document.querySelectorAll<HTMLInputElement>('input[id^="fullName-new-"]')[0]!, { target: { value: "Host" } });
    await waitFor(() => expect(saveButton().disabled).toBe(false), { timeout: 2000 });
    fireEvent.click(saveButton());

    await waitFor(() => expect(calls("/full")).toHaveLength(1));
    const [url, init] = calls("/full")[0]!;
    expect(url).toBe("/api/admin/registrations/r1/full");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.expectedUpdatedAt).toBe("2026-09-20T10:00:00.000Z");
    expect(body.participants.map((p: { id?: string }) => p.id)).toEqual(["p1", "p2", undefined]);
    expect(body.participants[2]).toMatchObject({ fullName: "Host", pricingType: "STANDARD", mealPricingType: "STANDARD", mealIds: [] });
    expect(body).not.toHaveProperty("email");
    expect(JSON.stringify(body)).not.toMatch(/Price"|price"|amount/);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("removing a person leaves them out of the save", async () => {
    renderEditor();
    await priced(); // the price on open is the stored one
    previewReturns(445, [445]);
    fireEvent.click(screen.getAllByText(RD.removeParticipant)[1]!);
    await waitFor(() => expect(saveButton().disabled).toBe(false), { timeout: 2000 });
    fireEvent.click(saveButton());
    await waitFor(() => expect(calls("/full")).toHaveLength(1));
    expect(JSON.parse(calls("/full")[0]![1].body as string).participants.map((p: { id: string }) => p.id)).toEqual(["p1"]);
  });

  it("a name too short is caught before sending", async () => {
    renderEditor();
    await priced();
    fireEvent.change(byId("fullName-p1")!, { target: { value: "J" } });
    expect(screen.getByText(RD.fullNameError)).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText(RD.saveRefused.validation)).toBeTruthy());
    expect(calls("/full")).toHaveLength(0);
  });

  it("a refused meal names the person", async () => {
    renderEditor();
    await priced();
    fetchMock().mockResolvedValue({ ok: false, status: 422, json: async () => ({ code: "meal_outside_stay", participantIndex: 1, mealId: "l1" }) });
    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText(RD.saveRefused.meal_outside_stay.replace("{name}", "Eva Malá"))).toBeTruthy());
  });

  it("a refused tier names the person AND the half", async () => {
    renderEditor();
    await priced();
    fetchMock().mockResolvedValue({ ok: false, status: 422, json: async () => ({ code: "tier_unavailable", participantIndex: 0, half: "meals" }) });
    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(screen.getByText(RD.saveRefused.tier_unavailable_meals.replace("{name}", "Jan Novák ml."))).toBeTruthy(),
    );
  });

  it("someone saved in between: says so and offers a reload", async () => {
    renderEditor();
    await priced();
    fetchMock().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "registration_changed" }) });
    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText(RD.saveRefused.registration_changed, { exact: false })).toBeTruthy());
    fireEvent.click(screen.getByText(RD.reload));
    expect(refresh).toHaveBeenCalled();
  });

  it("an unrecognised failure falls back to the generic message", async () => {
    renderEditor();
    await priced();
    fetchMock().mockResolvedValue({ ok: false, status: 500, json: async () => ({ code: "something_new" }) });
    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText(RD.saveFailed)).toBeTruthy());
  });

  it("unticking and re-ticking a meal is not a change", async () => {
    renderEditor();
    fireEvent.click(meal("p1", "b1")!);
    fireEvent.click(meal("p1", "b1")!);
    expect(screen.queryByText(RD.unsaved)).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it("an in-app link asks before leaving unsaved changes, and stays when told to", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = renderEditor();
    const link = document.createElement("a");
    link.href = "/cs/admin/registrations";
    container.appendChild(link);

    fireEvent.click(link);
    expect(confirm).not.toHaveBeenCalled(); // nothing to lose yet

    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(confirm).toHaveBeenCalledWith(RD.leaveWarning);
    expect(event.defaultPrevented).toBe(true);
    confirm.mockRestore();
  });

  it("discarding returns to the stored state", () => {
    renderEditor();
    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jiné jméno" } });
    fireEvent.click(screen.getByText(RD.discard));
    expect(byId<HTMLInputElement>("fullName-p1")!.value).toBe("Jan Novák");
    expect(screen.queryByText(RD.unsaved)).toBeNull();
  });
});

// ─── Resending the confirmation (M47, kept) ───────────────────────────────────

describe("resending the confirmation", () => {
  it("is disabled for a cancelled registration, and says why", () => {
    renderEditor(data({ status: "CANCELLED" }));
    expect(resendButton().disabled).toBe(true);
    expect(screen.getByText(RD.resendCancelled)).toBeTruthy();
  });

  it("stays available for a registered one", () => {
    renderEditor();
    expect(resendButton().disabled).toBe(false);
  });

  it("follows the status the admin selected, not the stored one", () => {
    renderEditor();
    fireEvent.change(statusSelect(), { target: { value: "CANCELLED" } });
    expect(resendButton().disabled).toBe(true);
    expect(screen.getByText(RD.resendCancelled)).toBeTruthy();
  });

  it("waits for unsaved changes to be saved — it always sends the stored version", () => {
    renderEditor();
    fireEvent.change(byId("fullName-p1")!, { target: { value: "Jan Novák ml." } });
    expect(resendButton().disabled).toBe(true);
    expect(screen.getByText(RD.resendNeedsSave)).toBeTruthy();
  });
});
