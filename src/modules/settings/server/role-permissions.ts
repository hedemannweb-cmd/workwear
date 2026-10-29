import "server-only";
import { z } from "zod";
import { audit } from "@/server/audit";
import { type Actor } from "@/server/actor";
import { forbidden } from "@/server/errors";
import { CONFIGURABLE_ROLES, PERMISSIONS, type Permission } from "@/server/permissions";
import { getRolePermissions, rolePermissionsKey } from "@/server/role-permissions";
import { runInTransaction } from "@/server/tx";

const inputSchema = z.object({
  role: z.enum(CONFIGURABLE_ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
});

/**
 * Speichert die Rechte einer Rolle. Nur Administratoren (Rolle, kein delegierbares Recht),
 * damit sich niemand über diese Seite selbst weitere Rechte verschaffen kann.
 */
export async function updateRolePermissions(actor: Actor, raw: z.input<typeof inputSchema>) {
  if (actor.role !== "ADMIN") throw forbidden();
  const input = inputSchema.parse(raw);
  // Reihenfolge der Matrix beibehalten, Duplikate entfernen
  const wanted = new Set<Permission>(input.permissions);
  const permissions = PERMISSIONS.filter((p) => wanted.has(p));
  const key = rolePermissionsKey(input.role);
  await runInTransaction(async (tx) => {
    const before = await getRolePermissions(input.role, tx);
    await tx.appSetting.upsert({
      where: { key },
      create: { key, value: permissions, updatedById: actor.userId },
      update: { value: permissions, updatedById: actor.userId },
    });
    const oldList = PERMISSIONS.filter((p) => before.has(p));
    if (oldList.join() !== permissions.join()) {
      await audit(tx, {
        actorId: actor.userId,
        action: "ROLE_PERMISSIONS_CHANGED",
        entityType: "Role",
        entityId: input.role,
        oldValue: oldList,
        newValue: permissions,
      });
    }
  });
}
