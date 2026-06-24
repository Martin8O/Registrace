// lib/audit — DB audit log writer (P4). Records every admin write operation to
// the AuditLog table (provisioned ahead of time; P4 adds the `ip` column + these
// writes). Best-effort / non-blocking: a failure here must NEVER roll back or
// fail the business operation (same spirit as invariant 6 / email), so errors are
// logged and swallowed. Call AFTER the business write commits.
//
// AuditLog rows are append-only — never mutated or deleted.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

// The set of audited actions. Events + registrations were the P4 spec; centre +
// user management were added on iteration (those admin writes are at least as
// security-sensitive — creating/removing admins, (de)activating centres).
export type AuditAction =
  | "event.create"
  | "event.update"
  | "event.status_change"
  | "registration.update"
  | "registration.status_change"
  | "registration.export"
  | "email.resend"
  | "center.create"
  | "center.update"
  | "center.activate"
  | "center.deactivate"
  | "user.invite"
  | "user.update"
  | "user.remove"
  | "user.password_reset";

export type AuditParams = {
  userId: string | null; // actor (= Supabase auth uuid / User.id); null only for system writes
  ip?: string | null;
  action: AuditAction;
  entityType: string; // "Event" | "Registration"
  entityId: string;
  oldData?: unknown; // pre-image (null for creates)
  newData?: unknown; // post-image / applied changes
};

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined || value === null ? undefined : (value as Prisma.InputJsonValue);
}

export async function logAuditEvent(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        ip: params.ip ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldData: asJson(params.oldData),
        newData: asJson(params.newData),
      },
    });
  } catch (err) {
    console.error(
      `[audit] failed to record ${params.action} on ${params.entityType}:${params.entityId}`,
      err,
    );
  }
}

// One row of the audit log, shaped for the admin read surface (the SUPER_ADMIN
// API + the Logs page both use this — single source of truth).
export type AuditLogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorEmail: string | null;
  ip: string | null;
  oldData: unknown;
  newData: unknown;
  createdAt: string; // UTC ISO (formatted to Europe/Prague in the UI)
};

// The most recent audit entries, newest first, with the actor email joined.
// SUPER_ADMIN-only is enforced by the callers (the API route + the page guard);
// append-only table — this is read-only.
export async function listAuditLogs(limit = 200): Promise<AuditLogRow[]> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { email: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    actorId: r.userId,
    actorEmail: r.user?.email ?? null,
    ip: r.ip,
    oldData: r.oldData,
    newData: r.newData,
    createdAt: r.createdAt.toISOString(),
  }));
}
