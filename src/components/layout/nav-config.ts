import type { Permission } from "@/server/permissions";

export type NavIcon =
  | "dashboard"
  | "employees"
  | "departments"
  | "articles"
  | "inventory"
  | "orders"
  | "receipts"
  | "quotas"
  | "suppliers"
  | "users"
  | "settings"
  | "audit"
  | "permissions";

/** "ADMIN_ONLY": nur für die Rolle Administrator, nicht über Rollenrechte delegierbar. */
export type NavItem = { href: string; label: string; icon: NavIcon; permission: Permission | "ADMIN_ONLY" };

/** Hauptnavigation (Vorgabe 24). Sichtbarkeit nach Berechtigung – nur Komfort, keine Sicherheitsmaßnahme. */
export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard", permission: "dashboard:view" },
  { href: "/employees", label: "Mitarbeiter", icon: "employees", permission: "employee:view" },
  { href: "/departments", label: "Abteilungen", icon: "departments", permission: "department:manage" },
  { href: "/articles", label: "Arbeitskleidung", icon: "articles", permission: "inventory:view" },
  { href: "/inventory", label: "Lager", icon: "inventory", permission: "inventory:view" },
  { href: "/orders", label: "Bestellungen", icon: "orders", permission: "order:view" },
  { href: "/goods-receipts", label: "Wareneingang", icon: "receipts", permission: "goodsReceipt:create" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/quotas", label: "Kontingente", icon: "quotas", permission: "quota:adjust" },
  { href: "/admin/suppliers", label: "Lieferanten", icon: "suppliers", permission: "supplier:manage" },
  { href: "/admin/users", label: "Benutzer", icon: "users", permission: "user:manage" },
  { href: "/admin/permissions", label: "Rollenrechte", icon: "permissions", permission: "ADMIN_ONLY" },
  { href: "/admin/settings", label: "Einstellungen", icon: "settings", permission: "settings:manage" },
  { href: "/admin/audit-log", label: "Audit Log", icon: "audit", permission: "audit:view" },
];
