// The refusal contract shared by the two admin full-edit endpoints (M50): every
// error the service can raise comes back with its own status and stable `code`
// — the editor turns the code into a sentence saying what to do.

import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import * as regs from "@/modules/registrations";
import { fullEditErrorResponse, readJsonBody } from "./full-edit";

describe("fullEditErrorResponse", () => {
  it.each([
    [new regs.RegistrationForbiddenError(), 403, "forbidden"],
    [new regs.RegistrationNotFoundError(), 404, "not_found"],
    [new regs.RegistrationChangedError(), 409, "registration_changed"],
    [new regs.RegistrationCapacityError(), 409, "capacity_reached"],
    [new regs.RegistrationStayInvalidError("same_day_evening_arrival"), 422, "stay_invalid"],
    [new regs.RegistrationMealInvalidError("meal_closed", 0, "m1"), 422, "meal_closed"],
    [new regs.RegistrationMealInvalidError("meal_outside_stay", 0, "m1"), 422, "meal_outside_stay"],
    [new regs.RegistrationMealInvalidError("meal_unknown", 0, "m1"), 422, "meal_unknown"],
    [new regs.RegistrationCenterInvalidError(), 422, "center_invalid"],
    [new regs.RegistrationPricingTypeUnavailableError(), 422, "tier_unavailable"],
    [new regs.RegistrationParticipantMismatchError(), 422, "participant_unknown"],
  ])("maps %o to its status and code", async (err, status, code) => {
    const res = fullEditErrorResponse(err)!;
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });

  it("names WHICH stay rule broke, so the editor can say it", async () => {
    const res = fullEditErrorResponse(new regs.RegistrationStayInvalidError("departure_before_arrival"))!;
    expect(await res.json()).toMatchObject({ reason: "departure_before_arrival" });
  });

  it("says WHICH person and WHICH meal a meal refusal is about", async () => {
    const res = fullEditErrorResponse(new regs.RegistrationMealInvalidError("meal_outside_stay", 2, "b1"))!;
    expect(await res.json()).toMatchObject({ code: "meal_outside_stay", participantIndex: 2, mealId: "b1" });
  });

  it("says WHICH person and WHICH half a tier refusal is about", async () => {
    const err = new regs.RegistrationPricingTypeUnavailableError("x", { participantIndex: 1, half: "meals" });
    expect(await fullEditErrorResponse(err)!.json()).toMatchObject({ code: "tier_unavailable", participantIndex: 1, half: "meals" });
  });

  it("returns null for anything else — the route re-throws it", () => {
    expect(fullEditErrorResponse(new Error("db down"))).toBeNull();
  });
});

describe("readJsonBody", () => {
  const req = (body: string) =>
    new NextRequest("http://localhost:3000/x", { method: "POST", body, headers: { "content-type": "application/json" } });

  it("a body that is not JSON → 400 bad_json, not a 500", async () => {
    const out = await readJsonBody(req("{not json"));
    expect("response" in out && out.response.status).toBe(400);
    expect("response" in out && (await out.response.json())).toMatchObject({ code: "bad_json" });
  });

  it("parses a JSON body", async () => {
    expect(await readJsonBody(req('{"a":1}'))).toEqual({ body: { a: 1 } });
  });
});
