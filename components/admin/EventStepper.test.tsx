// @vitest-environment jsdom
//
// The admin event wizard — specifically the one thing about it that reaches a
// registrant: the description. The admin types it into a textarea, so it can hold
// line breaks and blank lines, and the public detail page now renders them as
// typed. The review step (step 6) is the last screen before publishing, so if it
// flattened the text it would be the one place the admin sees something other
// than the result.
//
// This is also the only part of M43 no click-through could cover: opening the
// wizard means signing in, and signing in means typing a password into a form.
//
// Messages come from the REAL locale file, so a missing key fails here instead of
// rendering as a raw key in front of an admin.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
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

function renderWizard() {
  return render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <EventStepper centers={centers} />
    </NextIntlClientProvider>,
  );
}

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

afterEach(cleanup);

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
