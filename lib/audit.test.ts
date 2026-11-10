import { describe, it, expect, vi, beforeEach } from "vitest";

// Removing an admin deletes their User row and the database sets AuditLog.userId
// to null. Before each row kept its author's e-mail, every change that admin had
// made read as "systém" from then on.
const h = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  auditFindMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: h.userFindUnique },
    auditLog: { create: h.auditCreate, findMany: h.auditFindMany },
  },
}));

import { listAuditLogs, logAuditEvent } from "./audit";

beforeEach(() => vi.clearAllMocks());

describe("logAuditEvent", () => {
  it("stores the author's e-mail with their id", async () => {
    h.userFindUnique.mockResolvedValue({ email: "admin@example.cz" });
    await logAuditEvent({ userId: "u1", action: "event.update", entityType: "Event", entityId: "e1" });
    expect(h.auditCreate.mock.calls[0]![0].data).toMatchObject({ userId: "u1", actorEmail: "admin@example.cz" });
  });

  it("stores no e-mail for a system write", async () => {
    await logAuditEvent({ userId: null, action: "event.status_change", entityType: "Event", entityId: "e1" });
    expect(h.userFindUnique).not.toHaveBeenCalled();
    expect(h.auditCreate.mock.calls[0]![0].data).toMatchObject({ userId: null, actorEmail: null });
  });

  it("still writes the row when the author's e-mail cannot be looked up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.userFindUnique.mockRejectedValue(new Error("connection reset"));
    await logAuditEvent({ userId: "u1", action: "event.update", entityType: "Event", entityId: "e1" });
    expect(h.auditCreate.mock.calls[0]![0].data).toMatchObject({ userId: "u1", actorEmail: null });
  });
});

describe("listAuditLogs", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "a1", action: "event.update", entityType: "Event", entityId: "e1", ip: null,
    oldData: null, newData: null, createdAt: new Date("2026-11-01T10:00:00Z"), ...over,
  });

  it("still names an admin who has since been removed", async () => {
    h.auditFindMany.mockResolvedValue([row({ userId: null, user: null, actorEmail: "removed@example.cz" })]);
    expect((await listAuditLogs())[0]!.actorEmail).toBe("removed@example.cz");
  });

  it("shows an existing admin's current e-mail", async () => {
    h.auditFindMany.mockResolvedValue([row({ userId: "u1", user: { email: "new@example.cz" }, actorEmail: "old@example.cz" })]);
    expect((await listAuditLogs())[0]!.actorEmail).toBe("new@example.cz");
  });

  it("leaves a system write without an author", async () => {
    h.auditFindMany.mockResolvedValue([row({ userId: null, user: null, actorEmail: null })]);
    expect((await listAuditLogs())[0]!.actorEmail).toBeNull();
  });
});
