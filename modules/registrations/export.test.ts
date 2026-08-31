import { describe, it, expect, vi } from "vitest";
import type { AdminContext } from "@/modules/auth";

// Mock only the I/O boundary (Prisma); the row-shaping + localization logic runs
// for real. No live DB exists for tests (Supabase is the only instance) — same
// strategy as submit.test.ts. findMany ignores its args here; the where-clause /
// ownership scoping is the DB's job and isn't what this unit asserts.
const h = vi.hoisted(() => ({ findMany: vi.fn(), eventFindMany: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    registration: { findMany: h.findMany },
    event: { findMany: h.eventFindMany },
  },
}));

import { buildRegistrationExport, buildRegistrationExportWorkbook } from "./index";

const ctx = {
  role: "SUPER_ADMIN",
  userId: "u1",
  ip: null,
  centerIds: [],
} as unknown as AdminContext;

function fakeRows() {
  return [
    {
      registrationNumber: "260020001",
      email: "jan@example.cz",
      status: "REGISTERED",
      totalPrice: 300,
      createdAt: new Date("2026-05-10T08:00:00Z"),
      hasAccommodation: true,
      earlyDeparture: "NONE",
      arrivalTime: "MORNING",
      event: {
        title_cs: "Letní kurz",
        title_en: "Summer course",
        center: { name_cs: "Praha", name_en: "Prague" },
      },
      center: { name_cs: "Brno", name_en: "Brno" }, // registrant's home centre
      arrivalDate: { label_cs: "Pá", label_en: "Fri" },
      departureDate: { label_cs: "Ne", label_en: "Sun" },
      participants: [
        {
          // Surplus room, supported food — the two-tier case the feature exists
          // for. One tier column could not say this.
          fullName: "Jan Novák",
          ageCategory: "AGE_15_PLUS",
          pricingType: "SURPLUS",
          mealPricingType: "SUPPORTED",
          mealType: "MEAT",
          participationPrice: 200,
          mealPrice: 100,
          totalPrice: 300,
          meals: [{ eventMeal: { label_cs: "Pá oběd", label_en: "Fri lunch" } }],
        },
        {
          // A CHILD on a non-standard tier — four such people are already live,
          // and a real BDC course charges ages 8–14.
          fullName: "Eva Malá",
          ageCategory: "AGE_8_14",
          pricingType: "SUPPORTED",
          mealPricingType: "SUPPORTED",
          mealType: "VEGETARIAN",
          participationPrice: 0,
          mealPrice: 50,
          totalPrice: 50,
          meals: [],
        },
      ],
    },
  ];
}

describe("buildRegistrationExport", () => {
  it("builds localized Czech headers + a row with per-participant column groups", async () => {
    h.findMany.mockResolvedValue(fakeRows());
    const { headers, rows, sheetName } = await buildRegistrationExport({}, ctx, "cs");

    expect(sheetName).toBe("Data – vše");
    expect(headers[0]).toBe("Č. registrace");
    expect(headers).toContain("Centrum akce");
    expect(headers).toContain("Domovské centrum");
    expect(headers).not.toContain("Akce"); // event name is now the sheet title, not a column
    // 13 base columns + 2 participants × 9 = 31 (Akce column removed; the group
    // gained a second tier column — participation and meals are priced apart)
    expect(headers).toHaveLength(31);

    const row = rows[0]!;
    expect(row[0]).toBe("260020001");
    expect(row[3]).toBe("Praha"); // event centre (cs)
    expect(row[4]).toBe("Brno"); // home centre
    expect(row[5]).toBe("Registrován/a"); // status label
    expect(row[9]).toBe("Ne"); // early departure NONE → Ne
    expect(row[10]).toBe("Ano"); // accommodation YES → Ano
    expect(row[11]).toBe(300); // total stays a number
    expect(row[12]).toBe(2); // participant count
    // Participant 1 (15+): name=13, age=14, stay tier=15, meal tier=16,
    // diet=17 … meals=21
    expect(row[13]).toBe("Jan Novák");
    expect(row[14]).toBe("15 let a více");
    expect(row[15]).toBe("Nadbytek"); // participation tier
    expect(row[16]).toBe("Podporovaná"); // meal tier — independent of the above
    expect(row[17]).toBe("Masitá"); // diet (MEAT)
    expect(row[21]).toBe("Pá oběd"); // joined meal labels
    // Participant 2 (child): name=22, age=23, stay tier=24, meal tier=25, diet=26
    expect(row[22]).toBe("Eva Malá");
    expect(row[26]).toBe("Vegetariánská"); // diet shown for every age
  });

  it("shows both tiers for a CHILD too — the tier applies at every age", async () => {
    // This replaces an assertion that pinned the opposite: the sheet used to blank
    // the tier for anyone under 15 (the pre-M37 invariant 15, when tiers were a
    // 15+ concept). The engine never had that age branch, so the export was hiding
    // the tier that produced the very amount in the next column, and an admin
    // could not reconcile a child's price against the price list.
    h.findMany.mockResolvedValue(fakeRows());
    const { headers, rows } = await buildRegistrationExport({}, ctx, "cs");

    expect(headers[24]).toBe("Účastník 2 — typ ceny za účast");
    expect(headers[25]).toBe("Účastník 2 — typ ceny za stravu");
    expect(rows[0]![24]).toBe("Podporovaná"); // child's participation tier
    expect(rows[0]![25]).toBe("Podporovaná"); // child's meal tier
  });

  it("localizes to English when lang = en", async () => {
    h.findMany.mockResolvedValue(fakeRows());
    const { headers, rows, sheetName } = await buildRegistrationExport({}, ctx, "en");
    expect(sheetName).toBe("Data – all");
    expect(headers[0]).toBe("Reg. no.");
    expect(rows[0]![3]).toBe("Prague"); // event centre (en)
    expect(rows[0]![5]).toBe("Registered"); // status
  });

  it("still emits one participant column group when there are no rows", async () => {
    h.findMany.mockResolvedValue([]);
    const { headers, rows } = await buildRegistrationExport({}, ctx, "cs");
    expect(rows).toHaveLength(0);
    expect(headers).toHaveLength(22); // 13 base + 1 group × 9
  });
});

describe("buildRegistrationExport — ownership scoping (cross-center IDOR regression)", () => {
  const admin = {
    role: "ADMIN",
    userId: "admin-a",
    ip: null,
    centerIds: ["center-A"],
  } as unknown as AdminContext;

  it("keeps the ADMIN ownership filter even when the body supplies a foreign centerId", async () => {
    h.findMany.mockResolvedValue([]);
    // A scoped ADMIN tries to export another centre by passing its id in filters.
    await buildRegistrationExport({ centerId: "center-B" }, admin, "cs");

    const where = h.findMany.mock.calls.at(-1)![0].where;
    // The ownership scope must NOT be overwritten by the client centerId — both
    // constraints coexist under AND, so the query can only ever return rows whose
    // event centre is in the admin's own centres (∩ {center-B} = ∅ here).
    expect(where.event.AND).toContainEqual({ centerId: { in: ["center-A"] } });
    expect(where.event.AND).toContainEqual({ centerId: "center-B" });
    // Regression guard: the foreign centerId must never sit on event.centerId
    // directly (that was the overwrite that leaked cross-center PII).
    expect(where.event.centerId).toBeUndefined();
  });

  it("a SUPER_ADMIN may legitimately filter by any centre (no ownership scope)", async () => {
    h.findMany.mockResolvedValue([]);
    await buildRegistrationExport({ centerId: "center-B" }, ctx, "cs"); // ctx = SUPER_ADMIN

    const where = h.findMany.mock.calls.at(-1)![0].where;
    // ownEventFilter is {} for SUPER_ADMIN → AND holds only the client filter.
    expect(where.event.AND).toContainEqual({});
    expect(where.event.AND).toContainEqual({ centerId: "center-B" });
  });
});

describe("buildRegistrationExportWorkbook", () => {
  it("returns four sheets: full data, selection, meals, accommodation", async () => {
    h.findMany.mockResolvedValue(fakeRows());
    h.eventFindMany.mockResolvedValue([]); // no events in scope → empty kitchen sheets
    const { sheets } = await buildRegistrationExportWorkbook({}, ctx, "cs");

    expect(sheets.map((s) => s.sheetName)).toEqual([
      "Data – vše",
      "Data – výběr",
      "Jídlo",
      "Ubytování",
    ]);
    // Kitchen sheets carry their headers even with no event in scope (no "Akce"
    // column — the event name is the sheet title now).
    expect(sheets[2]!.headers).toEqual(["Den", "Jídlo", "Celkem", "Masitá", "Vegetariánská"]);
    expect(sheets[2]!.rows).toHaveLength(0);
    expect(sheets[3]!.headers).toEqual(["Noc", "Počet osob"]);
    expect(sheets[3]!.rows).toHaveLength(0);
  });

  it("selection sheet = the agreed trimmed columns, sliced from the full sheet", async () => {
    h.findMany.mockResolvedValue(fakeRows());
    h.eventFindMany.mockResolvedValue([]);
    const { sheets } = await buildRegistrationExportWorkbook({}, ctx, "cs");
    const sel = sheets[1]!;

    expect(sel.headers).toEqual([
      "Č. registrace", "Stav", "Příjezd", "Čas příjezdu", "Odjezd",
      "Dřívější odjezd", "Ubytování", "Celková cena (Kč)", "Počet účastníků",
      "Účastník 1 — jméno",
    ]);
    expect(sel.rows[0]).toEqual([
      "260020001", "Registrován/a", "Pá", "Dopoledne", "Ne", "Ne", "Ano", 300, 2, "Jan Novák",
    ]);
  });
});
