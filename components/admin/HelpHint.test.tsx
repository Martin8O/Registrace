// @vitest-environment jsdom
//
// The "?" hints: a button beside a label that opens a short explanation and
// links to the matching section of the help page. What matters to an admin is
// that it opens, says the right thing, gets out of the way (Escape, a click
// elsewhere) and never throws away a half-filled wizard (the link opens a new tab).

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import cs from "@/locales/cs.json";
import HelpHint from "./HelpHint";

const H = cs.help.hints;
const plain = (s: string) => s.replace(/<\/?[a-z]+>/g, "");

function renderHint(topic: "rates" | "contact") {
  return render(
    <NextIntlClientProvider locale="cs" messages={cs}>
      <p>
        <span>Elsewhere</span>
        <HelpHint topic={topic} />
      </p>
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("a help hint", () => {
  it("starts closed, as a button named after its topic", () => {
    renderHint("rates");
    const button = screen.getByRole("button", { name: `Nápověda: ${H.rates.topic}` });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain(plain(H.rates.body[0]!));
  });

  it("opens on a click and shows every paragraph, formatted rather than as raw tags", () => {
    renderHint("rates");
    fireEvent.click(screen.getByRole("button"));
    for (const p of H.rates.body) expect(document.body.textContent).toContain(plain(p));
    expect(document.body.textContent).not.toContain("<b>");
    expect(document.querySelector("strong")?.textContent).toBe("Denní sazba");
  });

  it("links to its section of the help page in a new tab, so a half-filled wizard survives", () => {
    renderHint("rates");
    fireEvent.click(screen.getByRole("button"));
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/cs/admin/help#ceny");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toContain(H.rates.more.label);
  });

  it("has no link where there is nothing more to read", () => {
    renderHint("contact");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("closes on Escape and on a click elsewhere", () => {
    renderHint("rates");
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});
