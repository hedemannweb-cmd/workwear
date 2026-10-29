import "server-only";
import { z } from "zod";
import { type Actor, assertCan } from "@/server/actor";
import { audit, diff } from "@/server/audit";
import { db } from "@/server/db";
import { DomainError, notFound } from "@/server/errors";
import { runInTransaction } from "@/server/tx";

export const articleSchema = z.object({
  sku: z.string().trim().min(2, "Pflichtfeld").max(30).regex(/^[A-Za-z0-9._-]+$/, "Nur Buchstaben, Ziffern, . _ -"),
  name: z.string().trim().min(2, "Pflichtfeld").max(120),
  description: z.string().trim().max(2000).nullable().transform((v) => v || null),
  categoryId: z.string().min(1, "Bitte wählen"),
  quotaGroupId: z.string().min(1, "Bitte wählen"),
  manufacturer: z.string().trim().max(120).nullable().transform((v) => v || null),
  imageUrl: z.union([z.url({ protocol: /^https$/, error: "Nur https-Adressen" }), z.literal("")]).nullable().transform((v) => v || null),
  isStockItem: z.boolean(),
  active: z.boolean(),
});

export const variantMatrixSchema = z.object({
  articleId: z.string().min(1),
  color: z.string().trim().max(40).nullable().transform((v) => v || null),
  sizeIds: z.array(z.string().min(1)).max(40),
  /** ohne Größe (Einheitsgröße) */
  withoutSize: z.boolean().default(false),
  minStock: z.number().int().min(0).max(9999).nullable(),
});

export const variantUpdateSchema = z.object({
  barcode: z.string().trim().max(40).nullable().transform((v) => v || null),
  minStock: z.number().int().min(0).max(9999).nullable(),
  active: z.boolean(),
});

export const articleSupplierSchema = z.object({
  articleId: z.string().min(1),
  supplierId: z.string().min(1),
  supplierSku: z.string().trim().max(60).nullable().transform((v) => v || null),
  purchasePrice: z.number().min(0).max(100000).nullable(),
  leadTimeDays: z.number().int().min(0).max(365).nullable(),
  isPreferred: z.boolean(),
});

export async function listArticles() {
  const [articles, stock] = await Promise.all([
    db.article.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        category: { select: { name: true } },
        quotaGroup: { select: { name: true } },
        variants: { select: { id: true, active: true, minStock: true } },
        suppliers: { where: { isPreferred: true }, include: { supplier: { select: { name: true } } } },
      },
    }),
    db.inventory.groupBy({ by: ["articleVariantId"], _sum: { physicalQuantity: true, reservedQuantity: true } }),
  ]);
  const byVariant = new Map(stock.map((s) => [s.articleVariantId, s._sum]));
  return articles.map((a) => {
    const sums = a.variants.map((v) => byVariant.get(v.id));
    const physical = sums.reduce((s, x) => s + (x?.physicalQuantity ?? 0), 0);
    const reserved = sums.reduce((s, x) => s + (x?.reservedQuantity ?? 0), 0);
    const below = a.variants.filter((v) => v.active && v.minStock !== null && (byVariant.get(v.id)?.physicalQuantity ?? 0) - (byVariant.get(v.id)?.reservedQuantity ?? 0) < v.minStock).length;
    return { ...a, physical, reserved, belowMin: below };
  });
}

export async function getArticle(id: string) {
  const article = await db.article.findUnique({
    where: { id },
    include: {
      category: { include: { sizeScale: { include: { sizes: { orderBy: { sortOrder: "asc" } } } } } },
      quotaGroup: true,
      variants: { include: { size: true, inventory: { include: { inventoryLocation: true } } } },
      suppliers: { include: { supplier: true }, orderBy: { isPreferred: "desc" } },
    },
  });
  if (!article) throw notFound("Der Artikel");
  article.variants.sort((a, b) => (a.color ?? "").localeCompare(b.color ?? "") || (a.size?.sortOrder ?? 0) - (b.size?.sortOrder ?? 0));
  return article;
}

/** currentCategoryId: beim Bearbeiten die bisherige Kategorie mitliefern, auch wenn sie inzwischen inaktiv ist. */
export async function articleFormOptions(currentCategoryId?: string) {
  const [categories, groups, suppliers] = await Promise.all([
    db.clothingCategory.findMany({ where: { OR: [{ active: true }, ...(currentCategoryId ? [{ id: currentCategoryId }] : [])] }, orderBy: { sortOrder: "asc" }, include: { sizeScale: true } }),
    db.quotaGroup.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { categories, groups, suppliers };
}

export async function saveArticle(actor: Actor, id: string | null, raw: z.input<typeof articleSchema>) {
  assertCan(actor, "article:manage");
  const input = articleSchema.parse(raw);
  return runInTransaction(async (tx) => {
    if (!id) {
      const a = await tx.article.create({ data: input });
      await audit(tx, { actorId: actor.userId, action: "ARTICLE_CREATED", entityType: "Article", entityId: a.id, newValue: input });
      return a;
    }
    const before = await tx.article.findUnique({ where: { id } });
    if (!before) throw notFound("Der Artikel");
    if (before.quotaGroupId !== input.quotaGroupId) {
      // Historische Buchungen tragen die Gruppe als Snapshot – eine Änderung wirkt nur auf künftige Vorgänge.
      const open = await tx.employeeReservation.count({ where: { articleVariant: { articleId: id }, status: { in: ["PENDING", "ORDERED", "RECEIVED"] } } });
      if (open > 0) throw new DomainError("VALIDATION", "Die Kontingentgruppe kann nicht geändert werden, solange offene Reservierungen bestehen.");
    }
    const a = await tx.article.update({ where: { id }, data: input });
    const changes = diff(before, input);
    if (changes) await audit(tx, { actorId: actor.userId, action: "ARTICLE_UPDATED", entityType: "Article", entityId: id, ...changes });
    return a;
  });
}

/** Varianten für mehrere Größen einer Farbe auf einmal anlegen (Größenmatrix). Bestehende werden übersprungen. */
export async function createVariants(actor: Actor, raw: z.input<typeof variantMatrixSchema>) {
  assertCan(actor, "article:manage");
  const input = variantMatrixSchema.parse(raw);
  return runInTransaction(async (tx) => {
    const article = await tx.article.findUnique({ where: { id: input.articleId }, include: { category: true, variants: true } });
    if (!article) throw notFound("Der Artikel");
    const sizes = input.withoutSize ? [null] : await tx.size.findMany({ where: { id: { in: input.sizeIds } }, orderBy: { sortOrder: "asc" } });
    if (!input.withoutSize && sizes.some((s) => s && s.sizeScaleId !== article.category.sizeScaleId)) {
      throw new DomainError("VALIDATION", "Die Größen passen nicht zur Größenskala der Kategorie.");
    }
    let created = 0;
    for (const size of sizes) {
      const exists = article.variants.some((v) => v.sizeId === (size?.id ?? null) && (v.color ?? null) === input.color);
      if (exists) continue;
      const colorPart = input.color ? `-${input.color.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()}` : "";
      const v = await tx.articleVariant.create({
        data: {
          articleId: article.id,
          sizeId: size?.id ?? null,
          color: input.color,
          minStock: input.minStock,
          variantSku: `${article.sku}${colorPart}${size ? `-${size.value}` : ""}`,
        },
      });
      await audit(tx, { actorId: actor.userId, action: "VARIANT_CREATED", entityType: "ArticleVariant", entityId: v.id, newValue: { variantSku: v.variantSku } });
      created++;
    }
    return { created };
  });
}

export async function updateVariant(actor: Actor, id: string, raw: z.input<typeof variantUpdateSchema>) {
  assertCan(actor, "article:manage");
  const input = variantUpdateSchema.parse(raw);
  await runInTransaction(async (tx) => {
    const before = await tx.articleVariant.findUnique({ where: { id } });
    if (!before) throw notFound("Die Variante");
    await tx.articleVariant.update({ where: { id }, data: input });
    const changes = diff(before, input);
    if (changes) await audit(tx, { actorId: actor.userId, action: "VARIANT_UPDATED", entityType: "ArticleVariant", entityId: id, ...changes });
  });
}

export async function saveArticleSupplier(actor: Actor, raw: z.input<typeof articleSupplierSchema>) {
  assertCan(actor, "article:manage");
  const input = articleSupplierSchema.parse(raw);
  await runInTransaction(async (tx) => {
    if (input.isPreferred) {
      await tx.articleSupplier.updateMany({ where: { articleId: input.articleId, isPreferred: true, NOT: { supplierId: input.supplierId } }, data: { isPreferred: false } });
    }
    const data = {
      supplierSku: input.supplierSku,
      purchasePrice: input.purchasePrice === null ? null : input.purchasePrice.toFixed(2),
      leadTimeDays: input.leadTimeDays,
      isPreferred: input.isPreferred,
    };
    await tx.articleSupplier.upsert({
      where: { articleId_supplierId: { articleId: input.articleId, supplierId: input.supplierId } },
      create: { articleId: input.articleId, supplierId: input.supplierId, ...data },
      update: data,
    });
    await audit(tx, { actorId: actor.userId, action: "ARTICLE_SUPPLIER_UPDATED", entityType: "Article", entityId: input.articleId, newValue: input });
  });
}
