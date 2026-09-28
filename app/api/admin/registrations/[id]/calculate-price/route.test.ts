// POST /api/admin/registrations/[id]/calculate-price — the live price of an
// admin's in-progress full edit (M50). Writes nothing; the service is mocked. The
// full refusal map is tested once, in app/api/_lib/full-edit.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ guard: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/app/api/_lib/guard", () => ({ requireAdminContext: h.guard }));
vi.mock("@/modules/registrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/registrations")>()),
  previewFullUpdate: h.service,
}));

import * as regs from "@/modules/registrations";
import { POST } from "./route";

const CTX = { userId: "u1", role: "SUPER_ADMIN", centerIds: [], ip: null };
const params = { params: Promise.resolve({ id: "r1" }) };

const body = {
  status: "REGISTERED",
  centerId: "c1",
  hasAccommodation: false,
  arrivalDateId: "d1",
  arrivalTime: "MORNING",
  departureDateId: "d3",
  earlyDeparture: "NONE",
  participants: [
    { id: "p1", fullName: "Jan Novák", ageCategory: "AGE_15_PLUS", pricingType: "STANDARD", mealPricingType: "SUPPORTED", mealType: "MEAT", mealIds: ["b1"] },
  ],
};
const RESULT = { totalPrice: 445, participants: [], mealDeadlinePassed: false };

const req = (payload: unknown, raw = false) =>
  new NextRequest("http://localhost:3000/api/admin/registrations/r1/calculate-price", {
    method: "POST",
    body: raw ? (payload as string) : JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.guard.mockResolvedValue({ ctx: CTX });
  h.service.mockResolvedValue(RESULT);
});

describe("POST /api/admin/registrations/[id]/calculate-price", () => {
  it("answers the guard's response and runs nothing when the guard refuses", async () => {
    h.guard.mockResolvedValue({ response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await POST(req(body), params);
    expect(res.status).toBe(401);
    expect(h.service).not.toHaveBeenCalled();
  });

  it("hands the request to the guard (the CSRF check applies to POST)", async () => {
    const r = req(body);
    await POST(r, params);
    expect(h.guard).toHaveBeenCalledWith(r);
  });

  it("a body that is not JSON → 400, service not called", async () => {
    const res = await POST(req("{not json", true), params);
    expect(res.status).toBe(400);
    expect(h.service).not.toHaveBeenCalled();
  });

  it("a body that fails validation → 400 with the issue path", async () => {
    const res = await POST(req({ ...body, participants: [] }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).details[0].path).toEqual(["participants"]);
    expect(h.service).not.toHaveBeenCalled();
  });

  it("needs no updatedAt — a preview is not a save", async () => {
    expect((await POST(req(body), params)).status).toBe(200);
  });

  it("calls the service with the id, the parsed body and the admin context → 200", async () => {
    const res = await POST(req(body), params);
    expect(await res.json()).toEqual({ data: RESULT });
    expect(h.service).toHaveBeenCalledWith("r1", expect.objectContaining({ arrivalDateId: "d1" }), CTX);
  });

  it("turns a refusal into its status and code", async () => {
    h.service.mockRejectedValue(new regs.RegistrationMealInvalidError("meal_outside_stay", 0, "b1"));
    const res = await POST(req(body), params);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "meal_outside_stay" });
  });

  it("does not swallow an unexpected failure", async () => {
    h.service.mockRejectedValue(new Error("db down"));
    await expect(POST(req(body), params)).rejects.toThrow("db down");
  });
});
