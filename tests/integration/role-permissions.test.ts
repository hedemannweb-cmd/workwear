import { beforeEach, describe, expect, it } from "vitest";
import { updateRolePermissions } from "@/modules/settings/server/role-permissions";
import { createUser, updateUser } from "@/modules/users/server/users";
import { assertCan, can, loadActor } from "@/server/actor";
import { db } from "@/server/db";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from "@/server/permissions";
import { getAllRolePermissions } from "@/server/role-permissions";
import { makeActor, resetDb } from "./fixtures";

beforeEach(async () => {
  await resetDb();
});

describe("Rollenrechte", () => {
  it("ohne Konfiguration gelten die Standardrechte", async () => {
    const all = await getAllRolePermissions();
    expect(all.MANAGER).toEqual({ permissions: [...DEFAULT_ROLE_PERMISSIONS.MANAGER], isDefault: true });
    const manager = await makeActor("MANAGER");
    const loaded = await loadActor(manager.userId);
    expect(can(loaded!, "order:manage")).toBe(true);
    expect(can(loaded!, "user:manage")).toBe(false);
  });

  it("Administrator ändert Rechte, wirksam beim nächsten Laden des Benutzers, mit Audit-Eintrag", async () => {
    const admin = await makeActor("ADMIN");
    const responsible = await makeActor("RESPONSIBLE");
    await updateRolePermissions(admin, { role: "RESPONSIBLE", permissions: ["dashboard:view", "inventory:adjust"] });

    const loaded = (await loadActor(responsible.userId))!;
    expect(can(loaded, "inventory:adjust")).toBe(true);
    expect(can(loaded, "issue:create")).toBe(false);
    expect(() => assertCan(loaded, "issue:create")).toThrow();

    const entry = await db.auditLog.findFirst({ where: { action: "ROLE_PERMISSIONS_CHANGED", entityId: "RESPONSIBLE" } });
    expect(entry?.newValue).toEqual(["dashboard:view", "inventory:adjust"]);

    // Admin bleibt voll berechtigt, unabhängig von der Konfiguration
    const adminLoaded = (await loadActor(admin.userId))!;
    expect(PERMISSIONS.every((p) => can(adminLoaded, p))).toBe(true);
  });

  it("nur Administratoren dürfen Rollenrechte ändern, auch mit allen anderen Rechten", async () => {
    const admin = await makeActor("ADMIN");
    await updateRolePermissions(admin, { role: "MANAGER", permissions: [...PERMISSIONS] });
    const manager = (await loadActor((await makeActor("MANAGER")).userId))!;
    await expect(updateRolePermissions(manager, { role: "MANAGER", permissions: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unbekannte Berechtigungen werden abgelehnt", async () => {
    const admin = await makeActor("ADMIN");
    await expect(updateRolePermissions(admin, { role: "MANAGER", permissions: ["foo:bar" as never] })).rejects.toThrow();
  });

  it("Manager mit Benutzerverwaltung kann keine Administratoren anlegen oder bearbeiten", async () => {
    const admin = await makeActor("ADMIN");
    await updateRolePermissions(admin, { role: "MANAGER", permissions: ["user:manage"] });
    const manager = (await loadActor((await makeActor("MANAGER")).userId))!;
    const base = { name: "Neu Admin", email: "neu@test.local", password: "GeheimGeheim123", active: true, restrictedToDepartments: false, departmentIds: [] };
    await expect(createUser(manager, { ...base, role: "ADMIN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateUser(manager, admin.userId, { name: "x y", email: admin.email, role: "MANAGER", active: true, restrictedToDepartments: false, departmentIds: [] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Verantwortliche anlegen ist erlaubt
    await expect(createUser(manager, { ...base, role: "RESPONSIBLE" })).resolves.toBeTruthy();
  });
});
