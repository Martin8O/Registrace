import { describe, it, expect, vi, beforeEach } from "vitest";

// The card image is a SECOND read of the event, made by a crawler with no
// cookies, on its own URL, possibly days after the page was fetched. It therefore
// needs the visibility gate in its own right — and it is the place a leak would
// be hardest to notice, because the offending name is baked into a PNG that chat
// clients cache for days.
//
// Satori itself is not exercised here (it would rasterise a real image for no
// added guarantee); the card renderer is stubbed so the assertions are about WHAT
// the route asks it to draw. Named og-image.test.ts rather than
// opengraph-image.test.ts so nothing can mistake it for a second metadata route.

import cs from "@/locales/cs.json";

const h = vi.hoisted(() => ({
  getPublicEventForDetail: vi.fn(),
  renderOgCard: vi.fn(async (content: unknown) => content),
}));

vi.mock("@/modules/events", () => ({ getPublicEventForDetail: h.getPublicEventForDetail }));
vi.mock("@/lib/og/card", () => ({
  OG_SIZE: { width: 1200, height: 630 },
  OG_CONTENT_TYPE: "image/png",
  renderOgCard: h.renderOgCard,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ namespace }: { namespace: string }) => {
    const messages = cs as unknown as Record<string, Record<string, string>>;
    return (key: string) => messages[namespace]?.[key] ?? `MISSING:${namespace}.${key}`;
  },
}));

import Image from "./opengraph-image";

const publishedEvent = {
  id: "evt1",
  title_cs: "Kolíňáci v Těnovicích",
  title_en: "Kolíňáci in Těnovice",
  startDate: "2026-09-18",
  endDate: "2026-09-20",
  center: { id: "c1", name_cs: "Těnovice", name_en: "Tenovice" },
};

beforeEach(() => {
  h.getPublicEventForDetail.mockReset();
  h.renderOgCard.mockClear();
});

describe("event card image", () => {
  it("draws the centre, the event and its dates for a published event", async () => {
    h.getPublicEventForDetail.mockResolvedValue(publishedEvent);

    await Image({ params: Promise.resolve({ locale: "cs", id: "evt1" }) });

    expect(h.renderOgCard).toHaveBeenCalledWith(
      expect.objectContaining({
        eyebrow: "Těnovice",
        title: "Kolíňáci v Těnovicích",
        footnote: "18.9.–20.9.",
      }),
    );
  });

  it("draws the neutral site card for a DRAFT or finished event", async () => {
    h.getPublicEventForDetail.mockResolvedValue(null);

    await Image({ params: Promise.resolve({ locale: "cs", id: "evt1" }) });

    const drawn = JSON.stringify(h.renderOgCard.mock.calls[0]?.[0]);
    expect(drawn).not.toContain("Kolíňáci");
    expect(h.renderOgCard).toHaveBeenCalledWith(
      expect.objectContaining({ title: cs.meta.siteName, footnote: cs.meta.description }),
    );
  });
});
