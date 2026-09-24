import "server-only";
import type { Tx } from "./tx";

/** Aktionen, die im Audit Log auftauchen. Bewusst als Union, damit Auswertungen stabil bleiben. */
export type AuditAction =
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_PASSWORD_RESET"
  | "DEPARTMENT_CREATED"
  | "DEPARTMENT_UPDATED"
  | "EMPLOYEE_CREATED"
  | "EMPLOYEE_UPDATED"
  | "EMPLOYEE_SIZES_UPDATED"
  | "EMPLOYEE_DEPARTMENT_CHANGED"
  | "EMPLOYEE_PSEUDONYMIZED"
  | "ARTICLE_CREATED"
  | "ARTICLE_UPDATED"
  | "VARIANT_CREATED"
  | "VARIANT_UPDATED"
  | "SUPPLIER_CREATED"
  | "SUPPLIER_UPDATED"
  | "ARTICLE_SUPPLIER_UPDATED"
  | "QUOTA_GROUP_CREATED"
  | "QUOTA_GROUP_UPDATED"
  | "QUOTA_PROFILE_CREATED"
  | "QUOTA_PROFILE_UPDATED"
  | "QUOTA_RULE_CHANGED"
  | "QUOTA_ADJUSTED"
  | "QUOTA_OVERRIDE"
  | "CLOTHING_ISSUED"
  | "CLOTHING_ISSUE_CANCELLED"
  | "CLOTHING_RETURNED"
  | "RESERVATION_CREATED"
  | "RESERVATION_CANCELLED"
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "ORDER_STATUS_CHANGED"
  | "ORDER_CANCELLED"
  | "GOODS_RECEIVED"
  | "INVENTORY_ADJUSTED"
  | "INVENTORY_LOCATION_UPDATED"
  | "SETTING_CHANGED";

export type AuditEntry = {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
};

/** Felder, die niemals im Audit Log landen dürfen. */
const SENSITIVE_KEY = /pass(word)?|token|secret|hash|session|cookie|authorization/i;

/** Macht Werte JSON-tauglich und entfernt sensible Felder (rekursiv). */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 6) return "[…]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && value !== null && "toFixed" in value && typeof (value as { toString: unknown }).toString === "function" && value.constructor?.name === "Decimal") {
    return (value as { toString(): string }).toString();
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeForAudit(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Schreibt einen Audit-Eintrag in derselben Transaktion wie die fachliche Änderung. */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue: (sanitizeForAudit(entry.oldValue) ?? undefined) as never,
      newValue: (sanitizeForAudit(entry.newValue) ?? undefined) as never,
      reason: entry.reason ?? null,
    },
  });
}

/** Liefert nur die geänderten Felder als {old,new}-Paar – hält das Audit Log lesbar. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { oldValue: Partial<T>; newValue: Partial<T> } | null {
  const oldValue: Partial<T> = {};
  const newValue: Partial<T> = {};
  for (const key of Object.keys(after) as Array<keyof T>) {
    const a = sanitizeForAudit(before[key]);
    const b = sanitizeForAudit(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      oldValue[key] = before[key];
      newValue[key] = after[key] as T[keyof T];
    }
  }
  return Object.keys(newValue).length ? { oldValue, newValue } : null;
}
