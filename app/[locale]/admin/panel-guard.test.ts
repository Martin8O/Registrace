import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── The admin panel must not depend on proxy.ts alone ────────────────────────
// proxy.ts redirects an unauthenticated visitor to the login — but its matcher
// skips every path containing a dot, and `[locale]` accepts any string. So
// `/a.b/admin/help` reached the app without ever meeting the proxy, and the help
// page (which had no check of its own) rendered for anyone. Three gates now, each
// pinned here:
//   1. an unknown locale is a 404 before anything under it renders,
//   2. the panel layout refuses to render without an admin,
//   3. every panel page checks for itself — a layout is skipped when a client
//      asks for the page segment alone, so (2) is a backstop, not the gate.

const h = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/modules/auth", () => ({ getAdminContext: h.getAdminContext }));
vi.mock("next/navigation", () => ({ redirect: h.redirect, notFound: h.notFound }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "cs",
  getMessages: async () => ({ admin: {}, help: { page: {}, hints: {} } }),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/components/admin/AdminSidebar", () => ({ default: () => null }));

import PanelLayout from "./(panel)/layout";
import LocaleLayout, { generateMetadata } from "../layout";

const PANEL = path.join(process.cwd(), "app", "[locale]", "admin", "(panel)");

function panelPages(dir: string = PANEL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return panelPages(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin panel — every page checks the session itself", () => {
  const pages = panelPages();

  it("finds the panel's pages", () => {
    // A walker that silently finds nothing would make the cases below vacuous.
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  it("each one resolves the admin and sends a stranger to the login", () => {
    // One case naming the offenders, not one case per page: the page list is read
    // from disk, and lib/readme-claims.test.ts can only count literal arrays.
    // A tripwire, not a proof: it sees that the check is WRITTEN in the page, in
    // the form every page uses — not that it runs before the page's data load.
    // A page that forgets fails here; a page that hides the two lines in dead
    // code does not.
    const unguarded = pages
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          // A client component cannot check anything on the server.
          /^\s*['"]use client['"]/m.test(source) ||
          !/await getAdminContext\(\)/.test(source) ||
          !/if \(!ctx\) redirect\(`\/\$\{locale\}\/admin\/login`\)/.test(source)
        );
      })
      .map((file) => path.relative(PANEL, file).replaceAll("\\", "/"));

    expect(unguarded).toEqual([]);
  });
});

describe("admin panel layout", () => {
  it("redirects to the login instead of rendering the shell for nobody", async () => {
    h.getAdminContext.mockResolvedValue(null);

    await expect(PanelLayout({ children: null })).rejects.toThrow("REDIRECT:/cs/admin/login");
  });

  it("renders for an admin", async () => {
    h.getAdminContext.mockResolvedValue({ role: "ADMIN" });

    await expect(PanelLayout({ children: null })).resolves.toBeTruthy();
    expect(h.redirect).not.toHaveBeenCalled();
  });
});

describe("[locale] layout", () => {
  it.each(["a.b", "robots.txt", "favicon.ico", "de"])("404s the unknown locale %s", async (locale) => {
    await expect(
      LocaleLayout({ children: null, params: Promise.resolve({ locale }) }),
    ).rejects.toThrow("NOT_FOUND");
    // …and builds no metadata for it either.
    expect(await generateMetadata({ params: Promise.resolve({ locale }) })).toEqual({});
  });

  it.each(["cs", "en"])("renders %s", async (locale) => {
    await expect(
      LocaleLayout({ children: null, params: Promise.resolve({ locale }) }),
    ).resolves.toBeTruthy();
    expect(h.notFound).not.toHaveBeenCalled();
  });
});
