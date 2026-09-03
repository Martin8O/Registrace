// @vitest-environment jsdom
//
// The admin event wizard. No click-through can cover it — opening it means
// signing in, and signing in means typing a password into a form — so what it
// does is pinned here instead.
//
// Two things are covered. The DESCRIPTION: the admin types it into a textarea, so
// it can hold line breaks and blank lines, and the public detail page now renders
// them as typed; the review step (step 6) is the last screen before publishing, so
// if it flattened the text it would be the one place the admin sees something
// other than the result.
//
// And PUBLISHING, which is a transition and not a state. Editing a published
// event's description asked "publish this event? it will become visible to the
// public" and then reported "event published" — about an event that had been
// public for days and whose visibility the edit did not touch.
//
// Messages come from the REAL locale file, so a missing key fails here instead of
// rendering as a raw key in front of an admin.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import cs from "@/locales/cs.json";
import EventStepper from "./EventStepper";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const F = cs.admin.eventForm;
const centers = [{ id: "c1", name_cs: "Těnovice", name_en: "Tenovice" }];

// What Martin actually typed into "Kolíňáci v Těnovicích": a lead-in line, a
// blank line, then three lines that only mean anything one under the other.
const DESCRIPTION = [
  "Při volbě ubytování zvolte:",
  "",
  "Dormitory -> Standard (200Kč / noc)",
  "Pokoj nebo chatka -> Nadbytek (300Kč / noc)",
  "Druhý nocležník v chatce/pokoji -> Standard (200 Kč / noc)",
].join("\n");

type Mode = { mode?: "create" | "edit"; status?: EventFormStatus; canEditRelations?: boolean };
type EventFormStatus = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";

function renderWizard(over: Mode = {}) {
  const isEdit = over.mode === "edit";
  return render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <EventStepper
        centers={centers}
        mode={over.mode ?? "create"}
        initial={isEdit ? { ...STORED, status: over.status ?? "DRAFT" } : undefined}
        editData={isEdit ? EDIT_DATA : undefined}
        canEditRelations={over.canEditRelations ?? false}
      />
    </NextIntlClientProvider>,
  );
}

// A stored event, as the edit page hands it over. Only `status` varies per test —
// everything about publishing keys off the STORED status, never the dropdown.
const STORED = {
  centerId: "c1",
  title_cs: "Kolíňáci v Těnovicích",
  title_en: "Kolinaci",
  description_cs: "",
  description_en: "",
  contactName: "Martin",
  contactPhone: "",
  contactEmail: "martin@example.cz",
  startDate: "2026-09-18",
  endDate: "2026-09-20",
};

const EDIT_DATA = {
  id: "e1",
  dates: [],
  meals: [],
  pricingRules: [],
  mealPricingRules: [],
  participationPricingTypes: ["STANDARD"],
  mealPricingTypes: ["STANDARD"],
};

const textareaFor = (name: string) =>
  document.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`);

const goToStep = (label: string) => {
  const tab = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );
  fireEvent.click(tab!);
};

/** The value cell of the review row labelled `label`. */
const previewValue = (label: string): HTMLElement | null => {
  const cell = [...document.querySelectorAll("span")].find(
    (s) => s.textContent?.trim() === label,
  );
  return (cell?.nextElementSibling as HTMLElement) ?? null;
};

beforeEach(() => {
  // The save posts to the API; these tests are about which dialog appears, not
  // about the request, so it always succeeds.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "e1" }) }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the description field", () => {
  it("is a textarea tall enough to show that it takes paragraphs", () => {
    renderWizard();
    // A 2-row box invited a one-liner; the public page renders whatever breaks
    // are typed, so the box has to look like somewhere breaks belong.
    expect(textareaFor("description_cs")?.rows).toBeGreaterThanOrEqual(5);
    expect(textareaFor("description_en")?.rows).toBeGreaterThanOrEqual(5);
  });

  it("keeps every line break the admin typed in its own value", () => {
    renderWizard();
    fireEvent.change(textareaFor("description_cs")!, { target: { value: DESCRIPTION } });
    expect(textareaFor("description_cs")!.value).toBe(DESCRIPTION);
  });
});

describe("the review step, the last screen before publishing", () => {
  it("carries the description through with its blank line intact", () => {
    renderWizard();
    fireEvent.change(textareaFor("description_cs")!, { target: { value: DESCRIPTION } });
    goToStep(F.steps.preview);

    const value = previewValue(F.fields.description_cs);
    expect(value).toBeTruthy();
    // Not a substring check: the whole string, breaks and blank line included.
    // Anything that flattened or trimmed it would fail here.
    expect(value!.textContent).toBe(DESCRIPTION);
    expect(value!.textContent!.split("\n")).toHaveLength(5);
  });

  // jsdom applies no Tailwind, so the class is the only thing this environment
  // can see of the rendering rule. It is asserted deliberately: `pre-line` is
  // exactly what makes the breaks above visible rather than collapsed, and
  // `pre-wrap` would be wrong (it would also preserve pasted indentation). What
  // it LOOKS like was verified in the browser; this pins that the rule is there.
  it("renders that value under the rule that makes the breaks visible", () => {
    renderWizard();
    fireEvent.change(textareaFor("description_cs")!, { target: { value: DESCRIPTION } });
    goToStep(F.steps.preview);

    const cls = previewValue(F.fields.description_cs)!.className;
    expect(cls).toContain("whitespace-pre-line");
    expect(cls).not.toContain("whitespace-pre-wrap");
  });

  it("still shows a dash where nothing was typed", () => {
    renderWizard();
    goToStep(F.steps.preview);
    expect(previewValue(F.fields.description_en)!.textContent).toBe("—");
  });
});

// ─── Publishing is a transition, not a state ─────────────────────────────────
// Reported from production: editing the description of an already-published
// event opened "Publish event? The event will be set to published and visible to
// the public" and, after saving, "Event published — it is now visible to the
// public". The event had been public for days and the edit changed nothing about
// that. Both messages were keyed on the FINAL status rather than on whether the
// save actually made the event public.

const buttonNamed = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

const dialogShows = (text: string) =>
  [...document.querySelectorAll("h2")].some((h) => h.textContent?.includes(text));

describe("saving an event that is ALREADY published", () => {
  const save = () => {
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.saveChanges)!);
  };

  it("does not ask permission to publish something already public", () => {
    renderWizard({ mode: "edit", status: "PUBLISHED" });
    save();
    expect(dialogShows(F.publishConfirmTitle)).toBe(false);
  });

  it("reports it as saved, not as newly published", async () => {
    renderWizard({ mode: "edit", status: "PUBLISHED" });
    save();
    await waitFor(() => expect(dialogShows(F.success.savedTitle)).toBe(true));
    expect(dialogShows(F.success.publishedTitle)).toBe(false);
  });

  // The two buttons differ only in that "save and publish" FORCES published —
  // on a public event that is either a no-op or, worse, silently undoes a status
  // the admin just moved to closed on the previous step.
  it("offers one honest button instead of two", () => {
    renderWizard({ mode: "edit", status: "PUBLISHED" });
    goToStep(F.steps.save);
    expect(buttonNamed(F.saveChanges)).toBeTruthy();
    expect(buttonNamed(F.saveAndPublish)).toBeFalsy();
    expect(buttonNamed(F.save)).toBeFalsy();
  });
});

describe("saving an event that is about to BECOME public", () => {
  it("still confirms when a draft is published from the wizard", () => {
    renderWizard({ mode: "edit", status: "DRAFT" });
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.saveAndPublish)!);
    expect(dialogShows(F.publishConfirmTitle)).toBe(true);
  });

  // A closed event going back to PUBLISHED IS becoming visible again, so it is
  // a transition like any other — "already published" must mean exactly that.
  it("still confirms when a closed event is published again", () => {
    renderWizard({ mode: "edit", status: "CLOSED" });
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.saveAndPublish)!);
    expect(dialogShows(F.publishConfirmTitle)).toBe(true);
  });

  it("still confirms on a brand-new event", () => {
    renderWizard();
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.saveAndPublish)!);
    expect(dialogShows(F.publishConfirmTitle)).toBe(true);
  });

  it("saves a draft as a draft with no confirmation at all", () => {
    renderWizard({ mode: "edit", status: "DRAFT" });
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.save)!);
    expect(dialogShows(F.publishConfirmTitle)).toBe(false);
  });
});
