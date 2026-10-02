// @vitest-environment jsdom
//
// The language switch re-navigates to the same page in the other locale, which
// remounts the page — so on a screen holding unsaved work (the admin registration
// editor) it has to ask first. It is a <button> calling router.push, not a link,
// which is exactly why the editor's own link interceptor never saw it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import LanguageSwitcher from "./LanguageSwitcher";
import { setUnsavedGuard } from "@/lib/utils/unsavedGuard";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/cs/admin/registrations/r1",
}));

const renderSwitcher = () =>
  render(
    <NextIntlClientProvider locale="cs" messages={{}}>
      <LanguageSwitcher />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  push.mockClear();
});
afterEach(() => {
  setUnsavedGuard(null);
  cleanup();
  vi.restoreAllMocks();
});

describe("LanguageSwitcher", () => {
  it("switches straight away when nothing is unsaved", () => {
    const confirm = vi.spyOn(window, "confirm");
    renderSwitcher();
    fireEvent.click(screen.getByText("EN"));
    expect(confirm).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/en/admin/registrations/r1");
  });

  it("asks first when a screen holds unsaved changes, and stays when told to", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setUnsavedGuard("Máte neuložené změny. Opravdu odejít?");
    renderSwitcher();
    fireEvent.click(screen.getByText("EN"));
    expect(confirm).toHaveBeenCalledWith("Máte neuložené změny. Opravdu odejít?");
    expect(push).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByText("EN"));
    expect(push).toHaveBeenCalledWith("/en/admin/registrations/r1");
  });

  it("does not ask about the language that is already on — that click goes nowhere", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setUnsavedGuard("unsaved");
    renderSwitcher();
    fireEvent.click(screen.getByText("CZ"));
    expect(confirm).not.toHaveBeenCalled();
  });
});
