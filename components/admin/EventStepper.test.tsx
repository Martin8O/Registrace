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

type Mode = {
  mode?: "create" | "edit";
  status?: EventFormStatus;
  canEditRelations?: boolean;
  canUnpublish?: boolean;
  readOnly?: boolean;
};
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
        canUnpublish={over.canUnpublish ?? true}
        readOnly={over.readOnly ?? false}
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

// Back to draft would hide a live event from everyone holding its link, so once
// anyone has registered the server refuses it — and the wizard stops offering it.
describe("the status dropdown on a live event", () => {
  const statusOptions = () => {
    goToStep(F.steps.settings);
    const select = document.querySelector<HTMLSelectElement>('select[name="status"]');
    return [...select!.options].map((o) => o.textContent);
  };

  it("does not offer Draft once people have registered", () => {
    renderWizard({ mode: "edit", status: "PUBLISHED", canUnpublish: false });
    expect(statusOptions()).not.toContain(cs.admin.eventStatus.DRAFT);
    expect(statusOptions()).toContain(cs.admin.eventStatus.PUBLISHED);
  });

  it("still offers Draft while nobody has registered", () => {
    renderWizard({ mode: "edit", status: "PUBLISHED" });
    expect(statusOptions()).toContain(cs.admin.eventStatus.DRAFT);
  });
});

describe("when the server refuses the save", () => {
  it.each([
    ["event_ended", F.errors.eventEnded],
    ["unpublish_refused", F.errors.unpublishRefused],
  ])("words the %s refusal instead of a generic failure", async (code, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: code }) }),
    );
    renderWizard({ mode: "edit", status: "PUBLISHED" });
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.saveChanges)!);
    await waitFor(() => expect(document.body.textContent).toContain(message));
    expect(document.body.textContent).not.toContain(F.errors.submitFailed);
  });

  it("a locked event's save leaves the status out unless the admin changed it", async () => {
    // The form holds the status from when the page was opened. Echoing it back
    // would undo another admin's hand-close made in the meantime.
    const sent = () => JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].body);
    renderWizard({ mode: "edit", status: "PUBLISHED" });
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.saveChanges)!);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(sent()).not.toHaveProperty("status");
    expect(sent().title_cs).toBe("Kolíňáci v Těnovicích");
    cleanup();

    renderWizard({ mode: "edit", status: "PUBLISHED" });
    goToStep(F.steps.settings);
    fireEvent.change(document.querySelector<HTMLSelectElement>('select[name="status"]')!, { target: { value: "CLOSED" } });
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.saveChanges)!);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(sent().status).toBe("CLOSED");
  });

  it("says the data is wrong when the server's schema refuses it — not 'try again'", async () => {
    // 400 is what app/api/_lib/http.ts answers for a payload the schema refuses.
    // The wizard used to look for 422, which the server never sends, so this
    // case fell through to "saving failed, please try again" — advice that
    // cannot help, since the same data fails the same way every time.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Validation failed" }) }),
    );
    renderWizard({ mode: "edit", status: "PUBLISHED" });
    goToStep(F.steps.save);
    fireEvent.click(buttonNamed(F.saveChanges)!);
    await waitFor(() => expect(document.body.textContent).toContain(F.validationError));
    expect(document.body.textContent).not.toContain(F.errors.submitFailed);
  });
});

// An event that is over cannot be saved (the server answers 409 event_ended), so
// it gets no wizard — but it must stay READABLE: this is the only admin screen
// that shows an event's price list, meal days and settings, and the people
// settling payments after the event need exactly those. It used to be one
// sentence and a link, under a tooltip promising "view only".
describe("an event that is over, opened read-only", () => {
  it("shows the whole review and offers nothing that could be saved or stepped through", () => {
    renderWizard({ mode: "edit", status: "CLOSED", readOnly: true, canUnpublish: false });

    // The stored event is on the screen without a single click…
    expect(previewValue(F.fields.title_cs)?.textContent).toBe("Kolíňáci v Těnovicích");
    expect(previewValue(F.fields.startDate)?.textContent).toBe("2026-09-18");
    expect(previewValue(F.fields.contactEmail)?.textContent).toBe("martin@example.cz");
    expect(document.body.textContent).toContain(F.preview.pricing);
    expect(document.body.textContent).toContain(F.preview.settings);

    // …and there is no step to go to, no field to type into, nothing to save.
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelectorAll("input:not([type=hidden]), textarea, select")).toHaveLength(0);
    expect(document.body.textContent).not.toContain(F.preview.intro);
  });

  it("prints the STORED price list — a cell the event never priced is 0, not the catalogue default", () => {
    // EDIT_DATA stores no price row at all. The wizard's state used to start from
    // the catalogue defaults (15+ standard 200 a day, 150 a night; lunch at the
    // default price) whatever the event stored, so this screen — now the reference
    // for settling payments — printed prices the engine never charged.
    renderWizard({ mode: "edit", status: "CLOSED", readOnly: true });
    const adultStandard = `${cs.admin.age.AGE_15_PLUS} · ${cs.admin.pricingType.STANDARD}`;
    const rows = [...document.querySelectorAll("span")].filter((s) => s.textContent?.trim() === adultStandard);
    expect(rows).toHaveLength(2); // the stay row and the meal row
    for (const row of rows) {
      const numbers = row.nextElementSibling!.textContent!.match(/\d+/g) ?? [];
      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers.every((n) => n === "0")).toBe(true);
    }
  });

  it("does not write its step into the address bar", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderWizard({ mode: "edit", status: "ARCHIVED", readOnly: true });
    expect(replaceState).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });
});
