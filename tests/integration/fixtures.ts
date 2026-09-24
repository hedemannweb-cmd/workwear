import { randomUUID } from "node:crypto";
import type { Role } from "@/generated/prisma/enums";
import { dateOnly } from "@/lib/dates";
import type { Actor } from "@/server/actor";
import { db } from "@/server/db";

/** Leert alle Anwendungstabellen (TRUNCATE umgeht die Unveränderlichkeits-Trigger bewusst). */
export async function resetDb() {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  for (const seq of ["issue_number_seq", "return_number_seq", "order_number_seq", "receipt_number_seq"]) {
    await db.$executeRawUnsafe(`ALTER SEQUENCE ${seq} RESTART WITH 1`);
  }
}

let userCounter = 0;
export async function makeActor(role: Role, departmentIds: string[] | null = null): Promise<Actor> {
  userCounter += 1;
  const user = await db.user.create({
    data: {
      name: `${role} ${userCounter}`,
      email: `${role.toLowerCase()}${userCounter}-${randomUUID().slice(0, 6)}@test.local`,
      role,
      restrictedToDepartments: departmentIds !== null,
      departmentScopes: departmentIds ? { create: departmentIds.map((departmentId) => ({ departmentId })) } : undefined,
    },
  });
  return { userId: user.id, name: user.name, email: user.email, role, departmentIds };
}

export const rid = () => randomUUID();

/**
 * Kleine, vollständige Testwelt:
 *  - Standardlager, Textil- und Hosengrößen
 *  - Gruppen T-Shirt (Profil Produktion: 5) und Hose (2)
 *  - Artikel T-Shirt (Varianten M, L, XL) und Arbeitshose (52, 54)
 *  - Abteilungen Produktion (Profil) und Lager (Profil mit 6 T-Shirts)
 *  - Lieferant mit Preisen
 */
export async function makeWorld() {
  const admin = await makeActor("ADMIN");

  const location = await db.inventoryLocation.create({ data: { code: "HAUPT", name: "Hauptlager", isDefault: true } });
  const textile = await db.sizeScale.create({
    data: { code: "TEXTIL", name: "Textil", sizes: { create: ["M", "L", "XL"].map((value, i) => ({ value, sortOrder: i })) } },
    include: { sizes: true },
  });
  const pants = await db.sizeScale.create({
    data: { code: "HOSE", name: "Hosen", sizes: { create: ["52", "54"].map((value, i) => ({ value, sortOrder: i })) } },
    include: { sizes: true },
  });
  const catTop = await db.clothingCategory.create({ data: { name: "Oberteile", sizeScaleId: textile.id } });
  const catPants = await db.clothingCategory.create({ data: { name: "Hosen", sizeScaleId: pants.id } });

  const gShirt = await db.quotaGroup.create({ data: { code: "TSHIRT", name: "T-Shirt", sortOrder: 1 } });
  const gPants = await db.quotaGroup.create({ data: { code: "HOSE", name: "Arbeitshose", sortOrder: 2 } });
  const gFree = await db.quotaGroup.create({ data: { code: "FREI", name: "Handschuhe", sortOrder: 9, isQuotaRelevant: false } });

  const profProd = await db.quotaProfile.create({
    data: {
      code: "PRODUKTION_STANDARD",
      name: "Produktion",
      rules: {
        create: [
          { quotaGroupId: gShirt.id, validFromYear: 2020, quantityPerYear: 5 },
          { quotaGroupId: gPants.id, validFromYear: 2020, quantityPerYear: 2 },
        ],
      },
    },
  });
  const profLager = await db.quotaProfile.create({
    data: {
      code: "LAGER_STANDARD",
      name: "Lager",
      rules: {
        create: [
          { quotaGroupId: gShirt.id, validFromYear: 2020, quantityPerYear: 6 },
          { quotaGroupId: gPants.id, validFromYear: 2020, quantityPerYear: 3 },
        ],
      },
    },
  });
  const depProd = await db.department.create({ data: { code: "PROD", name: "Produktion", quotaProfileId: profProd.id } });
  const depLager = await db.department.create({ data: { code: "LAGER", name: "Lager", quotaProfileId: profLager.id } });

  const supplier = await db.supplier.create({ data: { supplierNumber: "L-1", name: "Workwear GmbH" } });

  const shirt = await db.article.create({
    data: {
      sku: "TS-001",
      name: "T-Shirt",
      categoryId: catTop.id,
      quotaGroupId: gShirt.id,
      variants: { create: textile.sizes.map((s) => ({ variantSku: `TS-001-${s.value}`, sizeId: s.id, color: "Schwarz" })) },
      suppliers: { create: { supplierId: supplier.id, purchasePrice: "7.50", isPreferred: true, leadTimeDays: 14 } },
    },
    include: { variants: { include: { size: true } } },
  });
  const trousers = await db.article.create({
    data: {
      sku: "AH-001",
      name: "Arbeitshose",
      categoryId: catPants.id,
      quotaGroupId: gPants.id,
      variants: { create: pants.sizes.map((s) => ({ variantSku: `AH-001-${s.value}`, sizeId: s.id, color: "Grau" })) },
      suppliers: { create: { supplierId: supplier.id, purchasePrice: "32.00", isPreferred: true } },
    },
    include: { variants: { include: { size: true } } },
  });
  const gloves = await db.article.create({
    data: {
      sku: "HS-001",
      name: "Handschuhe",
      categoryId: catTop.id,
      quotaGroupId: gFree.id,
      variants: { create: [{ variantSku: "HS-001" }] },
    },
    include: { variants: true },
  });

  const v = (article: typeof shirt, size: string) => article.variants.find((x) => x.size?.value === size)!.id;

  return {
    admin,
    location,
    groups: { shirt: gShirt, pants: gPants, free: gFree },
    departments: { prod: depProd, lager: depLager },
    profiles: { prod: profProd, lager: profLager },
    supplier,
    variants: {
      shirtM: v(shirt, "M"),
      shirtL: v(shirt, "L"),
      shirtXL: v(shirt, "XL"),
      pants52: v(trousers, "52"),
      pants54: v(trousers, "54"),
      gloves: gloves.variants[0]!.id,
    },
  };
}

export type World = Awaited<ReturnType<typeof makeWorld>>;

let employeeCounter = 0;
export async function makeEmployee(departmentId: string, overrides: { entryDate?: string; status?: "ACTIVE" | "INACTIVE" | "LEFT" } = {}) {
  employeeCounter += 1;
  const entryDate = dateOnly(overrides.entryDate ?? "2020-01-01");
  return db.employee.create({
    data: {
      employeeNumber: `T${employeeCounter}-${randomUUID().slice(0, 4)}`,
      firstName: "Max",
      lastName: `Muster${employeeCounter}`,
      departmentId,
      entryDate,
      status: overrides.status ?? "ACTIVE",
      departmentHistory: { create: { departmentId, validFrom: entryDate } },
    },
  });
}

/** Lagerbestand über die normale Buchungslogik anlegen (damit Journal und Bestand konsistent sind). */
export async function stock(world: World, variantId: string, quantity: number) {
  const { adjustInventory } = await import("@/modules/inventory/server/adjust-inventory");
  await adjustInventory(world.admin, {
    mode: "delta",
    articleVariantId: variantId,
    inventoryLocationId: world.location.id,
    quantityDelta: quantity,
    reason: "Testbestand anlegen",
  });
}

export async function inventoryOf(world: World, variantId: string) {
  const row = await db.inventory.findUnique({
    where: { articleVariantId_inventoryLocationId: { articleVariantId: variantId, inventoryLocationId: world.location.id } },
  });
  return { physical: row?.physicalQuantity ?? 0, reserved: row?.reservedQuantity ?? 0 };
}

/** Invariante: Bestand = Summe der Bewegungen, je Variante × Lagerort. */
export async function assertJournalConsistent() {
  const rows = await db.$queryRaw<Array<{ id: string; physical: number; reserved: number; sum_q: bigint | null; sum_r: bigint | null }>>`
    SELECT i."id", i."physicalQuantity" AS physical, i."reservedQuantity" AS reserved,
           (SELECT SUM(m."quantityDelta") FROM "InventoryMovement" m WHERE m."articleVariantId" = i."articleVariantId" AND m."inventoryLocationId" = i."inventoryLocationId") AS sum_q,
           (SELECT SUM(m."reservedDelta") FROM "InventoryMovement" m WHERE m."articleVariantId" = i."articleVariantId" AND m."inventoryLocationId" = i."inventoryLocationId") AS sum_r
      FROM "Inventory" i`;
  for (const r of rows) {
    if (Number(r.sum_q ?? 0) !== r.physical || Number(r.sum_r ?? 0) !== r.reserved) {
      throw new Error(`Journal inkonsistent für Inventory ${r.id}: Bestand ${r.physical}/${r.reserved}, Journal ${r.sum_q}/${r.sum_r}`);
    }
  }
}
