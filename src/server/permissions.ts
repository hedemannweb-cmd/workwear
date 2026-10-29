import type { Role } from "@/generated/prisma/enums";

/**
 * Berechtigungen (KONZEPT.md H). Reine Daten: Die Rechte von Manager und Verantwortlichem sind
 * konfigurierbar (gespeichert in AppSetting, siehe modules/settings/server/role-permissions.ts),
 * ADMIN hat immer alle Rechte.
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

/** Rollen, deren Rechte ein Administrator auf /admin/permissions frei einstellen kann. ADMIN hat immer alle Rechte. */
export const CONFIGURABLE_ROLES = ["MANAGER", "RESPONSIBLE"] as const satisfies readonly Role[];
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export function isConfigurableRole(role: Role): role is ConfigurableRole {
  return (CONFIGURABLE_ROLES as readonly Role[]).includes(role);
}

/** Auslieferungsstand der Matrix. Gilt, solange für eine Rolle nichts gespeichert wurde. */
export const DEFAULT_ROLE_PERMISSIONS: Record<ConfigurableRole, readonly Permission[]> = {
  MANAGER: [
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
  ],
  RESPONSIBLE: [
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
  ],
};

/** Beschriftung und Gruppierung für die Rechteverwaltung. Reihenfolge = Anzeige. */
export const PERMISSION_GROUPS: { label: string; permissions: { key: Permission; label: string; warning?: string }[] }[] = [
  { label: "Allgemein", permissions: [{ key: "dashboard:view", label: "Dashboard ansehen" }, { key: "report:view", label: "Auswertungen und Kosten ansehen" }] },
  {
    label: "Mitarbeiter",
    permissions: [
      { key: "employee:view", label: "Mitarbeiter ansehen" },
      { key: "employee:manage", label: "Mitarbeiter anlegen, bearbeiten, pseudonymisieren" },
      { key: "employee:editSizes", label: "Größen pflegen" },
      { key: "employee:changeDepartment", label: "Abteilung wechseln" },
      { key: "department:manage", label: "Abteilungen verwalten" },
    ],
  },
  {
    label: "Kontingente",
    permissions: [
      { key: "quota:view", label: "Kontingente ansehen" },
      { key: "quota:adjust", label: "Kontingente anpassen" },
      { key: "quota:override", label: "Kontingent bei Ausgabe überschreiten" },
      { key: "quota:manageProfiles", label: "Profile, Gruppen und Regeln verwalten" },
    ],
  },
  {
    label: "Ausgabe und Rückgabe",
    permissions: [
      { key: "issue:create", label: "Kleidung ausgeben" },
      { key: "issue:cancelAny", label: "Beliebige Ausgaben stornieren" },
      { key: "issue:cancelOwnSameDay", label: "Eigene Ausgaben stornieren" },
      { key: "return:create", label: "Rückgaben buchen" },
      { key: "reservation:create", label: "Reservierungen anlegen" },
      { key: "reservation:cancel", label: "Reservierungen stornieren" },
    ],
  },
  {
    label: "Einkauf und Lager",
    permissions: [
      { key: "order:view", label: "Bestellungen ansehen" },
      { key: "order:manage", label: "Bestellungen anlegen und bearbeiten" },
      { key: "order:cancel", label: "Bestellungen stornieren" },
      { key: "goodsReceipt:create", label: "Wareneingang buchen" },
      { key: "inventory:view", label: "Lager und Artikel ansehen" },
      { key: "inventory:adjust", label: "Bestandskorrekturen buchen" },
      { key: "article:manage", label: "Artikel verwalten" },
      { key: "supplier:manage", label: "Lieferanten verwalten" },
    ],
  },
  {
    label: "Administration",
    permissions: [
      { key: "import:run", label: "Datenimport ausführen" },
      { key: "user:manage", label: "Benutzer verwalten", warning: "Administratoren und die Administratorrolle bleiben trotzdem Administratoren vorbehalten." },
      { key: "settings:manage", label: "Systemeinstellungen ändern" },
      { key: "audit:view", label: "Audit Log ansehen" },
    ],
  },
];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  RESPONSIBLE: "Verantwortlicher",
};
