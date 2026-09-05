import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the I/O boundary, keep the real metadata logic ──────────────────────
// The visibility gate is the whole security story of a link preview: a card that
// names a DRAFT event leaks it exactly as the page would, and a preview is copied
// and re-shared far more widely than a page is opened. So this drives the REAL
// generateMetadata and mocks only what it reads through — the public service (the
// gate itself, which lives in modules/events and 404s the page too) and the
// translations, which are read from the real locale files so the assertions are
// about the strings that actually ship.
//
// The page's client components are stubbed: importing the route module pulls them
// in, and none of them has anything to do with a meta tag.

import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

const h = vi.hoisted(() => ({ getPublicEventForDetail: vi.fn() }));

vi.mock("@/modules/events", () => ({
  getPublicEventForDetail: h.getPublicEventForDetail,
  getCentersForSelect: vi.fn(),
}));
vi.mock("@/components/public/PricingInfoButton", () => ({ default: () => null }));
vi.mock("@/components/public/RegistrationForm", () => ({ default: () => null }));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    // The locale files nest deeper than the two flat namespaces read here.
    const messages = (locale === "en" ? en : cs) as unknown as Record<
      string,
      Record<string, string>
    >;
    return (key: string) => messages[namespace]?.[key] ?? `MISSING:${namespace}.${key}`;
  },
}));

import { generateMetadata } from "./page";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Shaped like the live event Martin pasted into a chat and got a blank card for.
// The deadline is stored 21:59 UTC, which IS 23:59 in Prague — the one number a
// UTC render would state two hours early.
const publishedEvent = {
  id: "evt1",
  title_cs: "Kolíňáci v Těnovicích",
  title_en: "Kolíňáci in Těnovice",
  subtitle_cs: "Podtitul, který se nikam nesmí dostat",
  subtitle_en: "A subtitle that must not reach a meta tag",
  description_cs: "Při volbě ubytování zvolte účast:\n\nDormitory -> Standard (200Kč / noc)",
  description_en: null,
  startDate: "2026-09-18",
  endDate: "2026-09-20",
  mealRegistrationDeadline: "2026-09-16T21:59:00.000Z",
  center: { id: "c1", name_cs: "Těnovice", name_en: "Tenovice" },
};

const params = (locale: string, id = "evt1") => Promise.resolve({ locale, id });

beforeEach(() => {
  h.getPublicEventForDetail.mockReset();
});

describe("event page metadata", () => {
  it("previews a published event with its centre, name and dates", async () => {
    h.getPublicEventForDetail.mockResolvedValue(publishedEvent);

    const meta = await generateMetadata({ params: params("cs") });

    expect(meta.title).toBe("Těnovice — Kolíňáci v Těnovicích · 18.9.–20.9.");
    // `absolute` so the layout's "· Registrace na akce BDC" template does not eat
    // the card's one strong line; og:site_name carries the brand separately.
    expect(meta.openGraph?.title).toEqual({ absolute: "Těnovice — Kolíňáci v Těnovicích · 18.9.–20.9." });
    expect(meta.openGraph?.url).toBe("/cs/events/evt1");
    expect(meta.alternates?.canonical).toBe("/cs/events/evt1");
    expect(meta.alternates?.languages).toEqual({
      cs: "/cs/events/evt1",
      en: "/en/events/evt1",
    });
  });

  it("describes the event by its meal deadline, in Prague time", async () => {
    h.getPublicEventForDetail.mockResolvedValue(publishedEvent);

    const meta = await generateMetadata({ params: params("cs") });

    expect(meta.description).toBe("Přihlášení ke stravě do 16. 9. 2026 23:59");
    expect(meta.openGraph?.description).toBe(meta.description);
    expect(meta.twitter?.description).toBe(meta.description);
  });

  it("falls back to the site description when the event has no deadline", async () => {
    h.getPublicEventForDetail.mockResolvedValue({
      ...publishedEvent,
      mealRegistrationDeadline: null,
    });

    const meta = await generateMetadata({ params: params("cs") });

    expect(meta.description).toBe(cs.meta.description);
  });

  it("keeps the event's own prose out of every meta tag", async () => {
    h.getPublicEventForDetail.mockResolvedValue(publishedEvent);

    const meta = await generateMetadata({ params: params("cs") });

    // description_* is operational instructions — the live event's opens with a
    // price table, and its first 160 characters are worse than no description at
    // all. subtitle_* is a field the admin wizard cannot fill, so a card line
    // built on it would appear for seeded events and never for real ones.
    const rendered = JSON.stringify(meta);
    expect(rendered).not.toContain("Dormitory");
    expect(rendered).not.toContain("Podtitul");
    expect(rendered).not.toContain("A subtitle");
    // A newline in a description silently truncates the card on some clients.
    expect(meta.description).not.toContain("\n");
  });

  it("renders the English card from the English columns", async () => {
    h.getPublicEventForDetail.mockResolvedValue(publishedEvent);

    const meta = await generateMetadata({ params: params("en") });

    expect(meta.title).toBe("Tenovice — Kolíňáci in Těnovice · 18.9.–20.9.");
    expect(meta.description).toBe("Meal orders close 16. 9. 2026 23:59");
    expect(meta.openGraph?.url).toBe("/en/events/evt1");
  });

  it("falls back to the other language rather than previewing a nameless event", async () => {
    h.getPublicEventForDetail.mockResolvedValue({ ...publishedEvent, title_en: "   " });

    const meta = await generateMetadata({ params: params("en") });

    expect(meta.title).toBe("Tenovice — Kolíňáci v Těnovicích · 18.9.–20.9.");
  });

  it("gives a DRAFT or finished event the neutral site card and never names it", async () => {
    // getPublicEventForDetail returns null for both — the same gate that makes
    // the page 404 (P1 audit H1). An empty object inherits the layout's card.
    h.getPublicEventForDetail.mockResolvedValue(null);

    const meta = await generateMetadata({ params: params("cs") });

    expect(meta).toEqual({});
    expect(JSON.stringify(meta)).not.toContain("Kolíňáci");
  });

  it("reads through the public service, never around it", async () => {
    h.getPublicEventForDetail.mockResolvedValue(publishedEvent);

    await generateMetadata({ params: params("cs", "evt1") });

    expect(h.getPublicEventForDetail).toHaveBeenCalledWith("evt1");
  });
});
