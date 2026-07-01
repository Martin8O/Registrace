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
          fullName: "Jan Novák",
          ageCategory: "AGE_15_PLUS",
          pricingType: "STANDARD",
          mealType: "MEAT",
          participationPrice: 200,
          mealPrice: 100,
          totalPrice: 300,
          meals: [{ eventMeal: { label_cs: "Pá oběd", label_en: "Fri lunch" } }],
        },
        {
          fullName: "Eva Malá",
          ageCategory: "AGE_8_14",
          pricingType: "STANDARD",
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
    // 13 base columns + 2 participants × 8 = 29 (Akce column removed)
    expect(headers).toHaveLength(29);

    const row = rows[0]!;
    expect(row[0]).toBe("260020001");
    expect(row[3]).toBe("Praha"); // event centre (cs)
    expect(row[4]).toBe("Brno"); // home centre
    expect(row[5]).toBe("Registrován/a"); // status label
    expect(row[9]).toBe("Ne"); // early departure NONE → Ne
    expect(row[10]).toBe("Ano"); // accommodation YES → Ano
    expect(row[11]).toBe(300); // total stays a number
    expect(row[12]).toBe(2); // participant count
    // Participant 1 (15+): name=13, age=14, type=15, diet=16 … meals=20
    expect(row[13]).toBe("Jan Novák");
    expect(row[14]).toBe("15 let a více");
    expect(row[15]).toBe("Standardní");
    expect(row[16]).toBe("Masitá"); // diet (MEAT)
    expect(row[20]).toBe("Pá oběd"); // joined meal labels
    // Participant 2 (child): name=21, type=23, diet=24
    expect(row[21]).toBe("Eva Malá");
    expect(row[23]).toBe(""); // pricingType omitted for under-15 (invariant 15)
    expect(row[24]).toBe("Vegetariánská"); // diet shown for every age
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
    expect(headers).toHaveLength(21); // 13 base + 1 group × 8
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
