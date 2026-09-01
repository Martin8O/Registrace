// @vitest-environment jsdom
//
// The admin tier editor, rendered for real. Until M42 this component — like the
// public form and the price overview — was proven only by a click-through, which
// does not repeat itself: M41 verified it by hand on production and said so as a
// finding. These tests pin the rules that click-through checked, plus the ONE
// case it could not reach (a stranded tier, unreachable through the product
// because a published event's tier sets are frozen).
//
// Messages are the REAL locale files, so a missing key fails here rather than
// rendering as raw text in front of an admin.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import cs from "@/locales/cs.json";
import RegistrationDetailEditor, {
  type EditableParticipantTiers,
} from "./RegistrationDetailEditor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ADULT: EditableParticipantTiers = {
  id: "p1",
  fullName: "Jan Novák",
  pricingType: "SURPLUS",
  mealPricingType: "SUPPORTED",
};
const CHILD: EditableParticipantTiers = {
  id: "p2",
  fullName: "Eva Malá",
  pricingType: "SUPPORTED",
  mealPricingType: "SURPLUS",
};

const ALL = ["STANDARD", "SUPPORTED", "SURPLUS"];

function renderEditor(over: {
  participants?: EditableParticipantTiers[];
  participationPricingTypes?: string[];
  mealPricingTypes?: string[];
} = {}) {
  return render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <RegistrationDetailEditor
        registrationId="r1"
        centerId="c1"
        registrationNumber="260090009"
        numberLabel="Číslo registrace"
        pricingButton={null}
        initialHasAccommodation
        initialStatus="REGISTERED"
        initialParticipants={over.participants ?? [ADULT, CHILD]}
        participationPricingTypes={over.participationPricingTypes ?? ALL}
        mealPricingTypes={over.mealPricingTypes ?? ALL}
      >
        <div>summary</div>
      </RegistrationDetailEditor>
    </NextIntlClientProvider>,
  );
}

const stay = (id: string) => document.getElementById(`tier-participation-${id}`) as HTMLSelectElement | null;
const meal = (id: string) => document.getElementById(`tier-meal-${id}`) as HTMLSelectElement | null;
const optionsOf = (el: HTMLSelectElement) => [...el.options].map((o) => o.value);

beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── Which selectors render: the four variants M41 clicked, now permanent ─────

describe("which tier selectors render", () => {
  it("three tiers on both halves → both selects, prefilled with the stored tiers", () => {
    renderEditor();
    expect(stay("p1")!.value).toBe("SURPLUS");
    expect(meal("p1")!.value).toBe("SUPPORTED");
    expect(stay("p2")!.value).toBe("SUPPORTED");
    expect(meal("p2")!.value).toBe("SURPLUS");
  });

  it("one tier on both halves → no tier block at all", () => {
    renderEditor({
      participants: [{ ...ADULT, pricingType: "STANDARD", mealPricingType: "STANDARD" }],
      participationPricingTypes: ["STANDARD"],
      mealPricingTypes: ["STANDARD"],
    });
    expect(screen.queryByText(cs.admin.registrationDetail.pricingTiers)).not.toBeTruthy();
    expect(stay("p1")).toBeNull();
    expect(meal("p1")).toBeNull();
  });

  it("three participation tiers, one meal tier → only the participation select", () => {
    renderEditor({
      participants: [{ ...ADULT, mealPricingType: "STANDARD" }],
      mealPricingTypes: ["STANDARD"],
    });
    expect(stay("p1")).not.toBeNull();
    expect(meal("p1")).toBeNull();
  });

  // The variant that had never been exercised anywhere before M41.
  it("one participation tier, three meal tiers → only the meal select", () => {
    renderEditor({
      participants: [{ ...ADULT, pricingType: "STANDARD" }],
      participationPricingTypes: ["STANDARD"],
    });
    expect(stay("p1")).toBeNull();
    expect(meal("p1")).not.toBeNull();
  });

  it("an EMPTY set reads as all three, never as 'none offered'", () => {
    renderEditor({ participationPricingTypes: [], mealPricingTypes: [] });
    expect(optionsOf(stay("p1")!)).toEqual(ALL);
    expect(optionsOf(meal("p1")!)).toEqual(ALL);
  });

  it("each half lists only ITS own set — never the other half's", () => {
    renderEditor({
      participants: [{ ...ADULT, pricingType: "STANDARD" }],
      participationPricingTypes: ["STANDARD", "SUPPORTED"],
      mealPricingTypes: ALL,
    });
    expect(optionsOf(stay("p1")!)).toEqual(["STANDARD", "SUPPORTED"]);
    expect(optionsOf(meal("p1")!)).toEqual(ALL);
  });
});

// ─── The stranded tier: the one path the click-through could not reach ────────
// A published event's tier sets are frozen (they are not in updateEvent's
// writable whitelist), so this state needs a direct DB write to exist. That is
// exactly why it needs a test: nobody will ever click it into being.

describe("a participant stranded on a tier the event no longer offers", () => {
  // Reachable half of the backstop: the half still offers a choice, just not
  // THIS person's tier. `optionsFor` prepends the stored one.
  it("keeps the stored tier in the options, so the select cannot show a different one", () => {
    renderEditor({
      participants: [{ ...ADULT, pricingType: "SURPLUS" }],
      participationPricingTypes: ["STANDARD", "SUPPORTED"],
    });
    const el = stay("p1")!;
    // Without this the value matches no option and the browser renders the FIRST
    // one — the admin would be shown STANDARD for someone stored as SURPLUS, and
    // could save that without ever having chosen it.
    expect(optionsOf(el)).toEqual(["SURPLUS", "STANDARD", "SUPPORTED"]);
    expect(el.value).toBe("SURPLUS");
  });

  it("leaves the un-stranded half listing only what it offers", () => {
    renderEditor({
      participants: [{ ...ADULT, pricingType: "SURPLUS", mealPricingType: "STANDARD" }],
      participationPricingTypes: ["STANDARD", "SUPPORTED"],
      mealPricingTypes: ALL,
    });
    expect(optionsOf(meal("p1")!)).toEqual(ALL);
  });

  // KNOWN GAP, pinned deliberately rather than fixed (M42 finding N5, awaiting a
  // decision). `tiersEditable` opens the block for a stranded participant — its
  // comment says the admin "must at least be able to SEE" the tier — but each
  // select is gated on its half offering >1 tier, with no stranded exception. So
  // on a single-tier event the block opens showing the participant's NAME and no
  // control at all, and the stored tier stays invisible. Unreachable through the
  // product (a published event's tier sets are frozen and not in updateEvent's
  // writable whitelist, so this needs a direct DB write), which is exactly why it
  // needs a test: nobody will click it into being. Change this test WITH the fix.
  it("but on a single-tier event the block opens with no control at all (known gap)", () => {
    renderEditor({
      participants: [{ ...ADULT, pricingType: "SURPLUS", mealPricingType: "STANDARD" }],
      participationPricingTypes: ["STANDARD"],
      mealPricingTypes: ["STANDARD"],
    });
    expect(screen.getByText(cs.admin.registrationDetail.pricingTiers)).toBeTruthy();
    expect(screen.getByText("Jan Novák")).toBeTruthy();
    expect(stay("p1")).toBeNull();
    expect(meal("p1")).toBeNull();
  });
});

// ─── What the save actually sends ─────────────────────────────────────────────

describe("saving", () => {
  const save = () => fireEvent.click(screen.getByText(cs.admin.registrationDetail.save));

  it("sends CHOICES, never amounts, and carries every participant's two tiers", async () => {
    renderEditor();
    fireEvent.change(stay("p1")!, { target: { value: "STANDARD" } });
    save();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/admin/registrations/r1");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.participants).toEqual([
      { id: "p1", fullName: "Jan Novák", pricingType: "STANDARD", mealPricingType: "SUPPORTED" },
      { id: "p2", fullName: "Eva Malá", pricingType: "SUPPORTED", mealPricingType: "SURPLUS" },
    ]);
    // Nothing price-shaped is ever sent — the server re-prices (invariants 3–4).
    expect(JSON.stringify(body)).not.toMatch(/price|Price|amount/);
  });

  it("changing one participant's tier leaves the other's alone", async () => {
    renderEditor();
    fireEvent.change(meal("p2")!, { target: { value: "STANDARD" } });
    save();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    const body = JSON.parse(init.body as string);
    expect(body.participants[0]).toMatchObject({ pricingType: "SURPLUS", mealPricingType: "SUPPORTED" });
    expect(body.participants[1]).toMatchObject({ pricingType: "SUPPORTED", mealPricingType: "STANDARD" });
  });

  // Pins commit 0231e33 in the UI, not just in the response body: a refused save
  // must say WHY. "Try again" is wrong advice for every one of these codes.
  it("a refused save states the reason instead of telling the admin to retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code: "tier_unavailable" }) }),
    );
    renderEditor();
    save();

    const expected = cs.admin.registrationDetail.saveRefused.tier_unavailable;
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText(cs.admin.registrationDetail.saveFailed)).not.toBeTruthy();
  });

  it("an unrecognised failure still falls back to the generic message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code: "something_new" }) }),
    );
    renderEditor();
    save();

    await waitFor(() => expect(screen.getByText(cs.admin.registrationDetail.saveFailed)).toBeTruthy());
  });
});
