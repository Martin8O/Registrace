// @vitest-environment jsdom
//
// Logging out is the other exit that is a button calling router.push rather than
// a link, so the registration editor's link interceptor never sees it. It must
// ask BEFORE the session is ended: afterwards there is nothing left to stay on.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import cs from "@/locales/cs.json";
import LogoutButton from "./LogoutButton";
import { setUnsavedGuard } from "@/lib/utils/unsavedGuard";

const h = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: h.signOut } }) }));

const logout = () =>
  render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <LogoutButton />
    </NextIntlClientProvider>,
  );
const click = () => fireEvent.click(screen.getByText(cs.admin.nav.logout));

beforeEach(() => {
  vi.clearAllMocks();
  h.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  setUnsavedGuard(null);
  cleanup();
  vi.restoreAllMocks();
});

describe("LogoutButton", () => {
  it("signs out and goes to the login when nothing is unsaved", async () => {
    const confirm = vi.spyOn(window, "confirm");
    logout();
    click();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/cs/admin/login"));
    expect(confirm).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it("asks first when a screen holds unsaved changes — and keeps the session when told to stay", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setUnsavedGuard("Máte neuložené změny. Opravdu odejít?");
    logout();
    click();
    expect(confirm).toHaveBeenCalledWith("Máte neuložené změny. Opravdu odejít?");
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    click();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/cs/admin/login"));
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });
});
