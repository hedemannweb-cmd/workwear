import "server-only";
import { z } from "zod";
import type { Role } from "@/generated/prisma/enums";
import { db } from "./db";
import { CONFIGURABLE_ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, isConfigurableRole, type ConfigurableRole, type Permission } from "./permissions";
import type { Tx } from "./tx";

/** AppSetting-Schlüssel, unter dem die Rechte einer Rolle liegen (bewusst nicht in SETTINGS, eigene Admin-Seite). */
export const rolePermissionsKey = (role: ConfigurableRole) => `rolePermissions.${role}`;

const storedSchema = z.array(z.string());

/** Gespeicherte Werte filtern: unbekannte (z. B. umbenannte) Rechte werden ignoriert. */
function parseStored(value: unknown): Permission[] | null {
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success) return null;
  const known = new Set<string>(PERMISSIONS);
  return parsed.data.filter((p): p is Permission => known.has(p));
}

/** Aktuell gültige Rechte einer Rolle. ADMIN: alle; sonst gespeicherter Stand oder Auslieferungsstand. */
export async function getRolePermissions(role: Role, client: Tx | typeof db = db): Promise<Set<Permission>> {
  if (!isConfigurableRole(role)) return new Set(PERMISSIONS);
  const row = await client.appSetting.findUnique({ where: { key: rolePermissionsKey(role) } });
  return new Set(parseStored(row?.value) ?? DEFAULT_ROLE_PERMISSIONS[role]);
}

export async function getAllRolePermissions(): Promise<Record<ConfigurableRole, { permissions: Permission[]; isDefault: boolean }>> {
  const rows = await db.appSetting.findMany({ where: { key: { in: CONFIGURABLE_ROLES.map(rolePermissionsKey) } } });
  const result = {} as Record<ConfigurableRole, { permissions: Permission[]; isDefault: boolean }>;
  for (const role of CONFIGURABLE_ROLES) {
    const stored = parseStored(rows.find((r) => r.key === rolePermissionsKey(role))?.value);
    result[role] = { permissions: stored ?? [...DEFAULT_ROLE_PERMISSIONS[role]], isDefault: stored === null };
  }
  return result;
}
