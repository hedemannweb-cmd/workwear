import type { Role } from "@/generated/prisma/enums";

/**
 * Berechtigungsmatrix (KONZEPT.md H). Reine Daten + reine Funktionen: wird serverseitig für die
 * eigentliche Prüfung und clientseitig nur zum Ausblenden von Bedienelementen verwendet.
 *
 * "scoped" bedeutet: erlaubt, aber bei eingeschränkten Benutzern nur für Mitarbeiter der
 * zugewiesenen Abteilungen (Prüfung über assertEmployeeInScope / employeeScopeWhere).
 */
export const PERMISSIONS = [
  "dashboard:view",
  "employee:view",
  "employee:manage",
  "employee:editSizes",
  "employee:changeDepartment",
  "quota:view",
  "quota:adjust",
  "quota:override",
  "quota:manageProfiles",
  "issue:create",
  "issue:cancelAny",
  "issue:cancelOwnSameDay",
  "return:create",
  "reservation:create",
  "reservation:cancel",
  "order:view",
  "order:manage",
  "order:cancel",
  "goodsReceipt:create",
  "inventory:view",
  "inventory:adjust",
  "article:manage",
  "supplier:manage",
  "department:manage",
  "report:view",
  "import:run",
  "user:manage",
  "settings:manage",
  "audit:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const MANAGER = new Set<Permission>([
  "dashboard:view",
  "employee:view",
  "employee:manage",
  "employee:editSizes",
  "employee:changeDepartment",
  "quota:view",
  "quota:adjust",
  "quota:override",
  "issue:create",
  "issue:cancelAny",
  "issue:cancelOwnSameDay",
  "return:create",
  "reservation:create",
  "reservation:cancel",
  "order:view",
  "order:manage",
  "order:cancel",
  "goodsReceipt:create",
  "inventory:view",
  "inventory:adjust",
  "article:manage",
  "supplier:manage",
  "report:view",
  "audit:view",
]);

const RESPONSIBLE = new Set<Permission>([
  "dashboard:view",
  "employee:view",
  "employee:editSizes",
  "quota:view",
  "issue:create",
  "issue:cancelOwnSameDay",
  "return:create",
  "reservation:create",
  "reservation:cancel",
  "order:view",
  "goodsReceipt:create",
  "inventory:view",
]);

const MATRIX: Record<Role, Set<Permission>> = {
  ADMIN: ALL,
  MANAGER,
  RESPONSIBLE,
};

export function roleHas(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  RESPONSIBLE: "Verantwortlicher",
};
