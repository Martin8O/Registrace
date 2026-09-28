// PUT /api/admin/registrations/[id]/full — the admin FULL edit save (M50). The
// service is mocked; this pins the HTTP contract the editor relies on. The full
// refusal map is tested once, in app/api/_lib/full-edit.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({ guard: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/app/api/_lib/guard", () => ({ requireAdminContext: h.guard }));
vi.mock("@/modules/registrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/registrations")>()),
  applyFullUpdate: h.service,
}));

import * as regs from "@/modules/registrations";
import { PUT } from "./route";

const CTX = { userId: "u1", role: "SUPER_ADMIN", centerIds: [], ip: null };
const params = { params: Promise.resolve({ id: "r1" }) };

const state = {
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
const body = { ...state, expectedUpdatedAt: "2026-09-20T10:00:00.000Z" };
const RESULT = { id: "r1", totalPrice: 445, updatedAt: "2026-09-28T12:00:00.000Z" };

const req = (payload: unknown, raw = false) =>
  new NextRequest("http://localhost:3000/api/admin/registrations/r1/full", {
    method: "PUT",
    body: raw ? (payload as string) : JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.guard.mockResolvedValue({ ctx: CTX });
  h.service.mockResolvedValue(RESULT);
});

describe("PUT /api/admin/registrations/[id]/full", () => {
  it("answers the guard's response and runs nothing when the guard refuses", async () => {
    h.guard.mockResolvedValue({ response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await PUT(req(body), params);
    expect(res.status).toBe(401);
    expect(h.service).not.toHaveBeenCalled();
  });

  it("hands the request to the guard (the CSRF check applies to PUT)", async () => {
    const r = req(body);
    await PUT(r, params);
    expect(h.guard).toHaveBeenCalledWith(r);
  });

  it("a body that is not JSON → 400, service not called", async () => {
    const res = await PUT(req("{not json", true), params);
    expect(res.status).toBe(400);
    expect(h.service).not.toHaveBeenCalled();
  });

  it("a body that fails validation → 400 with the issue path", async () => {
    const res = await PUT(req({ ...body, participants: [] }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).details[0].path).toEqual(["participants"]);
    expect(h.service).not.toHaveBeenCalled();
  });

  it("refuses a save without the updatedAt the editor loaded", async () => {
    const res = await PUT(req(state), params);
    expect(res.status).toBe(400);
    expect(h.service).not.toHaveBeenCalled();
  });

  it("calls the service with the id, the parsed body and the admin context → 200", async () => {
    const res = await PUT(req(body), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: RESULT });
    expect(h.service).toHaveBeenCalledWith("r1", expect.objectContaining({ arrivalDateId: "d1" }), CTX);
  });

  it("turns a refusal into its status and code", async () => {
    h.service.mockRejectedValue(new regs.RegistrationChangedError());
    const res = await PUT(req(body), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "registration_changed" });
  });

  it("does not swallow an unexpected failure", async () => {
    h.service.mockRejectedValue(new Error("db down"));
    await expect(PUT(req(body), params)).rejects.toThrow("db down");
  });
});
