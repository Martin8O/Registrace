import { describe, it, expect, vi } from "vitest";
import type { AdminContext } from "@/modules/auth";

// Mock only the I/O boundary (Prisma); the row-shaping + localization logic runs
// for real. No live DB exists for tests (Supabase is the only instance) — same
// strategy as submit.test.ts. findMany ignores its args here; the where-clause /
// ownership scoping is the DB's job and isn't what this unit asserts.
const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  eventFindMany: vi.fn(),
  eventFindFirst: vi.fn(),
  eventDateFindMany: vi.fn(),
  eventMealFindMany: vi.fn(),
  participantMealFindMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    registration: { findMany: h.findMany },
    event: { findMany: h.eventFindMany, findFirst: h.eventFindFirst },
    eventDate: { findMany: h.eventDateFindMany },
    eventMeal: { findMany: h.eventMealFindMany },
    participantMeal: { findMany: h.participantMealFindMany },
  },
}));

import {
  buildRegistrationExport,
  buildRegistrationExportWorkbook,
  RegistrationEventNotFoundError,
} from "./index";

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

    expect(headers[24]).toBe("Účastník 2 — typ ceny za účast a noc");
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
  it("returns five sheets: selection, meals, accommodation, settlement, full data", async () => {
    h.findMany.mockResolvedValue(fakeRows());
    h.eventFindMany.mockResolvedValue([]); // no events in scope → empty kitchen sheets
    const { sheets } = await buildRegistrationExportWorkbook({}, ctx, "cs");

    expect(sheets.map((s) => s.sheetName)).toEqual([
      "Data – výběr",
      "Jídlo",
      "Ubytování",
      "Vyúčtování",
      "Data – vše",
    ]);
    // Kitchen sheets carry their headers even with no event in scope (no "Akce"
    // column — the event name is the sheet title now).
    expect(sheets[1]!.headers).toEqual(["Den", "Jídlo", "Celkem", "Masitá", "Vegetariánská"]);
    expect(sheets[1]!.rows).toHaveLength(0);
    expect(sheets[2]!.headers).toEqual(["Noc", "Počet osob"]);
    expect(sheets[2]!.rows).toHaveLength(0);
    expect(sheets[3]!.headers).toEqual([
      "Den",
      "Přihlášení – osob", "Přihlášení – ubytování (Kč)", "Přihlášení – denní sazba (Kč)",
      "Přihlášení – strava (Kč)", "Přihlášení – celkem (Kč)",
      "Zaplaceno – osob", "Zaplaceno – ubytování (Kč)", "Zaplaceno – denní sazba (Kč)",
      "Zaplaceno – strava (Kč)", "Zaplaceno – celkem (Kč)",
    ]);
    expect(sheets[3]!.rows).toHaveLength(0);
  });

  it("selection sheet = the agreed trimmed columns, sliced from the full sheet", async () => {
    h.findMany.mockResolvedValue(fakeRows());
    h.eventFindMany.mockResolvedValue([]);
    const { sheets } = await buildRegistrationExportWorkbook({}, ctx, "cs");
    const sel = sheets[0]!;

    expect(sel.headers).toEqual([
      "Č. registrace", "Stav", "Příjezd", "Čas příjezdu", "Odjezd",
      "Dřívější odjezd", "Ubytování", "Celková cena (Kč)", "Počet účastníků",
      "Účastník 1 — jméno",
    ]);
    expect(sel.rows[0]).toEqual([
      "260020001", "Registrován/a", "Pá", "Dopoledne", "Ne", "Ne", "Ano", 300, 2, "Jan Novák",
    ]);
  });

  // The selection sheet picks its columns BY NAME out of the full sheet. This
  // pins the mapping itself: the last selected column must be the FIRST
  // participant's name, i.e. the column right after the registration-level block
  // — the thing a newly inserted registration column would otherwise shift.
  it("selection's last column is participant 1's name, not whatever sits at index 13", async () => {
    h.findMany.mockResolvedValue(fakeRows());
    h.eventFindMany.mockResolvedValue([]);
    const { sheets } = await buildRegistrationExportWorkbook({}, ctx, "cs");
    const [main, sel] = [sheets[4]!, sheets[0]!];

    expect(sel.headers.at(-1)).toBe("Účastník 1 — jméno");
    // Every selected header really exists in the full sheet, in the same order.
    const positions = sel.headers.map((hd) => main.headers.indexOf(hd));
    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // …and the participant block starts immediately after the last selected
    // registration-level column, so the two never overlap.
    expect(main.headers.indexOf("Účastník 1 — jméno")).toBe(
      main.headers.indexOf("Počet účastníků") + 1,
    );
  });
});

// An eventId the admin may not see used to yield 200 + an empty workbook (no
// leak — every query is ownership-scoped — but it answered with a file where the
// registration detail answers 404). M41 finding N4.
describe("buildRegistrationExportWorkbook — unknown / out-of-scope event", () => {
  it("throws RegistrationEventNotFoundError instead of returning an empty workbook", async () => {
    h.eventFindFirst.mockResolvedValue(null); // not found, or not this admin's
    await expect(
      buildRegistrationExportWorkbook({ eventId: "foreign" }, ctx, "cs"),
    ).rejects.toBeInstanceOf(RegistrationEventNotFoundError);
  });

  it("does not even run the row query when the event is out of scope", async () => {
    h.eventFindFirst.mockResolvedValue(null);
    h.findMany.mockClear();
    await expect(
      buildRegistrationExportWorkbook({ eventId: "foreign" }, ctx, "cs"),
    ).rejects.toBeInstanceOf(RegistrationEventNotFoundError);
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("an in-scope event still builds all five sheets, titled with its label", async () => {
    h.eventFindFirst.mockResolvedValue({
      id: "e1",
      title_cs: "Letní kurz",
      title_en: "Summer course",
      center: { name_cs: "Praha", name_en: "Prague" },
      dates: [],
      pricingRules: [],
      registrations: [],
    });
    h.findMany.mockResolvedValue(fakeRows());
    h.eventDateFindMany.mockResolvedValue([]);
    h.eventMealFindMany.mockResolvedValue([]);
    h.participantMealFindMany.mockResolvedValue([]);

    const { sheets } = await buildRegistrationExportWorkbook({ eventId: "e1" }, ctx, "cs");
    expect(sheets).toHaveLength(5);
    expect(sheets.every((s) => s.title === "Praha — Letní kurz")).toBe(true);
  });
});

// "Vyúčtování": the event's stored money spread over its days, every active
// registration beside the paid ones. Hand-computed below; the sheet's totals must
// equal the stored prices to the crown.
describe("the settlement sheet", () => {
  const rule = (ageCategory: string, pricingType: string, dailyRate: number, nightRate: number) => ({
    ageCategory, pricingType, dailyRate, nightRate,
    morningArrivalDiscount: 0, afternoonArrivalDiscount: 50, eveningArrivalDiscount: 100,
    earlyDepartureDiscount: 80,
  });
  const meal = (price: number, eventDateId: string) => ({ price, eventMeal: { eventDateId } });
  const date = (id: string, sortOrder: number, label: string) => ({
    id, sortOrder, label_cs: label, label_en: label, date: new Date(`2026-11-0${sortOrder + 6}T00:00:00Z`),
  });

  const EVENT = {
    id: "e1",
    title_cs: "Letní kurz",
    title_en: "Summer course",
    center: { name_cs: "Praha", name_en: "Prague" },
    dates: [date("fri", 0, "Pá"), date("sat", 1, "So"), date("sun", 2, "Ne")],
    pricingRules: [rule("AGE_15_PLUS", "STANDARD", 100, 200), rule("AGE_15_PLUS", "SURPLUS", 150, 300)],
    registrations: [
      {
        // PAID, beds, evening arrival Fri → Sun. Adult standard: day 100×3 − 100 + nights 200×2 = 600.
        // Child with no rule: stay 0, one meal.
        status: "PAID", arrivalDateId: "fri", arrivalTime: "EVENING", departureDateId: "sun",
        earlyDeparture: "NONE", hasAccommodation: true,
        participants: [
          { ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", participationPrice: 600, mealPrice: 320,
            meals: [meal(120, "fri"), meal(80, "sat"), meal(120, "sat")] },
          { ageCategory: "AGE_4_7", pricingType: "STANDARD", participationPrice: 0, mealPrice: 60,
            meals: [meal(60, "sat")] },
        ],
      },
      {
        // REGISTERED, no beds, Sat morning → Sun after breakfast. Surplus: 150×2 − 80 = 220.
        status: "REGISTERED", arrivalDateId: "sat", arrivalTime: "MORNING", departureDateId: "sun",
        earlyDeparture: "AFTER_BREAKFAST", hasAccommodation: false,
        participants: [
          { ageCategory: "AGE_15_PLUS", pricingType: "SURPLUS", participationPrice: 220, mealPrice: 90,
            meals: [meal(90, "sun")] },
        ],
      },
    ],
  };

  async function settlement() {
    h.eventFindFirst.mockResolvedValue(EVENT);
    h.findMany.mockResolvedValue([]);
    h.eventDateFindMany.mockResolvedValue([]);
    h.eventMealFindMany.mockResolvedValue([]);
    h.participantMealFindMany.mockResolvedValue([]);
    const { sheets } = await buildRegistrationExportWorkbook({ eventId: "e1" }, ctx, "cs");
    return sheets.find((x) => x.sheetName === "Vyúčtování")!;
  }

  it("splits each day into people, beds, day rate and meals — all, then paid only", async () => {
    const { rows } = await settlement();
    //            people acc  day  meals sum | paid: people acc day meals sum
    expect(rows).toEqual([
      ["Pá", 2, 200, 0, 120, 320, 2, 200, 0, 120, 320],
      ["So", 3, 200, 250, 260, 710, 2, 200, 100, 260, 560],
      ["Ne", 3, 0, 170, 90, 260, 2, 0, 100, 0, 100],
      ["Celkem", 3, 400, 420, 470, 1290, 2, 400, 200, 380, 980],
    ]);
  });

  it("adds up to the stored prices exactly", async () => {
    const { rows } = await settlement();
    const stored = EVENT.registrations.flatMap((r) => r.participants)
      .reduce((s, p) => s + p.participationPrice + p.mealPrice, 0);
    expect(rows.at(-1)![5]).toBe(stored);
  });

  // A stay the engine floored at 0 (or any stored amount the split does not
  // reproduce) still has to land in the sheet, or its totals would drift from
  // what was charged.
  it("books a stored stay price the split does not reproduce on the arrival day", async () => {
    const reg = EVENT.registrations[1]!;
    const original = reg.participants[0]!.participationPrice;
    reg.participants[0]!.participationPrice = 250; // 30 more than the rules give
    try {
      const { rows } = await settlement();
      expect(rows[1]![3]).toBe(250 + 30); // Saturday's day rate, active group
      expect(rows.at(-1)![3]).toBe(420 + 30);
    } finally {
      reg.participants[0]!.participationPrice = original;
    }
  });

  it("squares a stored meal price its meal rows do not add up to on the arrival day", async () => {
    const p = EVENT.registrations[1]!.participants[0]!;
    p.mealPrice += 10;
    try {
      const { rows } = await settlement();
      expect(rows[1]![4]).toBe(260 + 10); // Saturday's meals, active group
      expect(rows.at(-1)![5]).toBe(1290 + 10);
    } finally {
      p.mealPrice -= 10;
    }
  });
});
