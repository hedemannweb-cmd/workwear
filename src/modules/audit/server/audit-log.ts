import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { type Actor, assertCan } from "@/server/actor";
import { db } from "@/server/db";

export async function listAuditLog(actor: Actor, filter: { entityType?: string; entityId?: string; action?: string; userId?: string; take?: number }) {
  assertCan(actor, "audit:view");
  const where: Prisma.AuditLogWhereInput = {
    ...(filter.entityType ? { entityType: filter.entityType } : {}),
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
  };
  const [rows, actions, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: filter.take ?? 500, include: { user: { select: { name: true } } } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      user: r.user?.name ?? "System",
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      oldValue: r.oldValue,
      newValue: r.newValue,
      reason: r.reason,
    })),
    actions: actions.map((a) => a.action),
    users,
  };
}
