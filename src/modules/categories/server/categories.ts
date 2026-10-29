import "server-only";
import { z } from "zod";
import { type Actor, assertCan } from "@/server/actor";
import { audit, diff } from "@/server/audit";
import { db } from "@/server/db";
import { invalidState, notFound } from "@/server/errors";
import { runInTransaction } from "@/server/tx";

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Pflichtfeld").max(80),
  sizeScaleId: z.string().nullable().transform((v) => v || null),
  sortOrder: z.coerce.number().int("Ganze Zahl").min(0).max(9999),
  active: z.boolean(),
});

export async function listCategories() {
  const [categories, sizeScales] = await Promise.all([
    db.clothingCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { sizeScale: { select: { name: true } }, _count: { select: { articles: true, employeeSizes: true } } },
    }),
    db.sizeScale.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return { categories, sizeScales };
}

/**
 * Größenskala nur änderbar, solange nichts an der Kategorie hängt: Artikelvarianten und
 * Mitarbeitergrößen verweisen auf Größen der bisherigen Skala.
 */
export async function saveCategory(actor: Actor, id: string | null, raw: z.input<typeof categorySchema>) {
  assertCan(actor, "category:manage");
  const input = categorySchema.parse(raw);
  return runInTransaction(async (tx) => {
    if (!id) {
      const c = await tx.clothingCategory.create({ data: input });
      await audit(tx, { actorId: actor.userId, action: "CATEGORY_CREATED", entityType: "ClothingCategory", entityId: c.id, newValue: input });
      return c;
    }
    const before = await tx.clothingCategory.findUnique({ where: { id }, include: { _count: { select: { articles: true, employeeSizes: true } } } });
    if (!before) throw notFound("Die Kategorie");
    if (before.sizeScaleId !== input.sizeScaleId && before._count.articles + before._count.employeeSizes > 0) {
      throw invalidState("Die Größenskala kann nicht mehr geändert werden, weil bereits Artikel oder Mitarbeitergrößen an der Kategorie hängen.");
    }
    const { _count, ...plain } = before; // eslint-disable-line @typescript-eslint/no-unused-vars
    const c = await tx.clothingCategory.update({ where: { id }, data: input });
    const changes = diff(plain, input);
    if (changes) await audit(tx, { actorId: actor.userId, action: "CATEGORY_UPDATED", entityType: "ClothingCategory", entityId: id, ...changes });
    return c;
  });
}

/** Löschen nur ohne Artikel und ohne kategoriebezogene Mitarbeitergrößen, sonst deaktivieren. */
export async function deleteCategory(actor: Actor, id: string) {
  assertCan(actor, "category:manage");
  return runInTransaction(async (tx) => {
    const before = await tx.clothingCategory.findUnique({ where: { id }, include: { _count: { select: { articles: true, employeeSizes: true } } } });
    if (!before) throw notFound("Die Kategorie");
    const { articles, employeeSizes } = before._count;
    if (articles > 0) {
      throw invalidState(`Die Kategorie enthält noch ${articles === 1 ? "einen Artikel" : `${articles} Artikel`}. Ordnen Sie diese erst einer anderen Kategorie zu oder deaktivieren Sie die Kategorie.`);
    }
    if (employeeSizes > 0) {
      throw invalidState(`Für diese Kategorie sind bei ${employeeSizes === 1 ? "einem Mitarbeiter" : `${employeeSizes} Mitarbeitern`} eigene Größen hinterlegt. Deaktivieren Sie die Kategorie stattdessen.`);
    }
    await tx.clothingCategory.delete({ where: { id } });
    const { _count, ...plain } = before; // eslint-disable-line @typescript-eslint/no-unused-vars
    await audit(tx, { actorId: actor.userId, action: "CATEGORY_DELETED", entityType: "ClothingCategory", entityId: id, oldValue: plain });
  });
}
