import { describe, it, expect, vi } from "vitest";
import type { AdminContext } from "@/modules/auth";

// Mock only the I/O boundary (Prisma); the row-shaping + localization logic runs
// for real. No live DB exists for tests (Supabase is the only instance) — same
// strategy as submit.test.ts. findMany ignores its args here; the where-clause /
// ownership scoping is the DB's job and isn't what this unit asserts.
const h = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { registration: { findMany: h.findMany } } }));

import { buildRegistrationExport } from "./index";

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
          participationPrice: 200,
          mealPrice: 100,
          totalPrice: 300,
          meals: [{ eventMeal: { label_cs: "Pá oběd", label_en: "Fri lunch" } }],
        },
        {
          fullName: "Eva Malá",
          ageCategory: "AGE_8_14",
          pricingType: "STANDARD",
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

    expect(sheetName).toBe("Registrace");
    expect(headers[0]).toBe("Č. registrace");
    expect(headers).toContain("Centrum akce");
    expect(headers).toContain("Domovské centrum");
    // 14 base columns + 2 participants × 7 = 28
    expect(headers).toHaveLength(28);

    const row = rows[0]!;
    expect(row[0]).toBe("260020001");
    expect(row[1]).toBe("Letní kurz"); // event title (cs)
    expect(row[4]).toBe("Praha"); // event centre (cs)
    expect(row[5]).toBe("Brno"); // home centre
    expect(row[6]).toBe("Registrován/a"); // status label
    expect(row[10]).toBe("Ne"); // early departure NONE → Ne
    expect(row[11]).toBe("Ano"); // accommodation YES → Ano
    expect(row[12]).toBe(300); // total stays a number
    expect(row[13]).toBe(2); // participant count
    // Participant 1 (15+): name=14, age=15, type=16 … meals=20
    expect(row[14]).toBe("Jan Novák");
    expect(row[15]).toBe("15 let a více");
    expect(row[16]).toBe("Standardní");
    expect(row[20]).toBe("Pá oběd"); // joined meal labels
    // Participant 2 (child): name=21 … type=23
    expect(row[21]).toBe("Eva Malá");
    expect(row[23]).toBe(""); // pricingType omitted for under-15 (invariant 15)
  });

  it("localizes to English when lang = en", async () => {
    h.findMany.mockResolvedValue(fakeRows());
    const { headers, rows, sheetName } = await buildRegistrationExport({}, ctx, "en");
    expect(sheetName).toBe("Registrations");
    expect(headers[0]).toBe("Reg. no.");
    expect(rows[0]![1]).toBe("Summer course");
    expect(rows[0]![6]).toBe("Registered");
  });

  it("still emits one participant column group when there are no rows", async () => {
    h.findMany.mockResolvedValue([]);
    const { headers, rows } = await buildRegistrationExport({}, ctx, "cs");
    expect(rows).toHaveLength(0);
    expect(headers).toHaveLength(21); // 14 base + 1 group × 7
  });
});
