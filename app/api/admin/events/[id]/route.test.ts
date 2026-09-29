// PUT /api/admin/events/[id] — the event wizard's save. The service is mocked;
// this pins the two refusals the wizard words for the admin (a 409 with a code),
// which would otherwise surface as a generic 500 "saving failed".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ guard: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/app/api/_lib/guard", () => ({ requireAdminContext: h.guard }));
vi.mock("@/modules/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/events")>()),
  updateEvent: h.service,
}));

import { EventEndedError, EventStatusTransitionError } from "@/modules/events";
import { PUT } from "./route";

const CTX = { userId: "u1", role: "SUPER_ADMIN", centerIds: [], ip: null };
const params = { params: Promise.resolve({ id: "e1" }) };
const req = () =>
  new NextRequest("http://localhost:3000/api/admin/events/e1", {
    method: "PUT",
    body: JSON.stringify({ title_cs: "Nový název" }),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.guard.mockResolvedValue({ ctx: CTX });
  h.service.mockResolvedValue({ id: "e1" });
});

describe("PUT /api/admin/events/[id]", () => {
  it("saves through the service", async () => {
    const res = await PUT(req(), params);
    expect(res.status).toBe(200);
    expect(h.service).toHaveBeenCalledWith("e1", expect.objectContaining({ title_cs: "Nový název" }), CTX);
  });

  it("an event that is over → 409 event_ended", async () => {
    h.service.mockRejectedValue(new EventEndedError());
    const res = await PUT(req(), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "event_ended" });
  });

  it("back to draft with registrations → 409 unpublish_refused", async () => {
    h.service.mockRejectedValue(new EventStatusTransitionError());
    const res = await PUT(req(), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "unpublish_refused" });
  });
});
