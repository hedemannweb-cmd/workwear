import { beforeEach, describe, expect, it } from "vitest";
import { deleteCategory, saveCategory } from "@/modules/categories/server/categories";
import { updateRolePermissions } from "@/modules/settings/server/role-permissions";
import { loadActor } from "@/server/actor";
import { db } from "@/server/db";
import { makeActor, makeWorld, resetDb } from "./fixtures";

beforeEach(async () => {
  await resetDb();
});

describe("Artikelkategorien", () => {
  it("anlegen, umbenennen und löschen, jeweils mit Audit-Eintrag", async () => {
    const admin = await makeActor("ADMIN");
    const c = await saveCategory(admin, null, { name: "Westen", sizeScaleId: null, sortOrder: 5, active: true });
    await saveCategory(admin, c.id, { name: "Warnwesten", sizeScaleId: null, sortOrder: 5, active: true });
    expect((await db.clothingCategory.findUnique({ where: { id: c.id } }))?.name).toBe("Warnwesten");

    await deleteCategory(admin, c.id);
    expect(await db.clothingCategory.findUnique({ where: { id: c.id } })).toBeNull();
    const actions = (await db.auditLog.findMany({ where: { entityId: c.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["CATEGORY_CREATED", "CATEGORY_UPDATED", "CATEGORY_DELETED"]);
  });

  it("Kategorie mit Artikeln lässt sich nicht löschen und die Größenskala nicht wechseln, Umbenennen und Deaktivieren geht", async () => {
    await makeWorld();
    const admin = await makeActor("ADMIN");
    const cat = await db.clothingCategory.findUniqueOrThrow({ where: { name: "Hosen" } });
    const textile = await db.sizeScale.findFirstOrThrow({ where: { NOT: { id: cat.sizeScaleId! } } });

    await expect(deleteCategory(admin, cat.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(saveCategory(admin, cat.id, { name: "Hosen", sizeScaleId: textile.id, sortOrder: 0, active: true })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await saveCategory(admin, cat.id, { name: "Arbeitshosen", sizeScaleId: cat.sizeScaleId, sortOrder: 0, active: false });
    expect(await db.clothingCategory.findUnique({ where: { id: cat.id } })).toMatchObject({ name: "Arbeitshosen", active: false });
  });

  it("doppelte Namen werden abgelehnt", async () => {
    const admin = await makeActor("ADMIN");
    await saveCategory(admin, null, { name: "Schuhe", sizeScaleId: null, sortOrder: 0, active: true });
    await expect(saveCategory(admin, null, { name: "Schuhe", sizeScaleId: null, sortOrder: 1, active: true })).rejects.toThrow();
  });

  it("ohne Recht category:manage verboten, Manager hat es standardmäßig", async () => {
    const admin = await makeActor("ADMIN");
    const manager = (await loadActor((await makeActor("MANAGER")).userId))!;
    await saveCategory(manager, null, { name: "Handschuhe", sizeScaleId: null, sortOrder: 0, active: true });

    const responsible = (await loadActor((await makeActor("RESPONSIBLE")).userId))!;
    await expect(saveCategory(responsible, null, { name: "Mützen", sizeScaleId: null, sortOrder: 0, active: true })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await updateRolePermissions(admin, { role: "MANAGER", permissions: ["article:manage"] });
    const restricted = (await loadActor(manager.userId))!;
    await expect(saveCategory(restricted, null, { name: "Mützen", sizeScaleId: null, sortOrder: 0, active: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
