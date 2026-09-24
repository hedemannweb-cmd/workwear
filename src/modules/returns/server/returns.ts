import "server-only";
import { z } from "zod";
import type { ReturnType } from "@/generated/prisma/enums";
import { applyStockChanges, getDefaultLocationId, type StockChange } from "@/modules/inventory/server/stock";
import { assertEmployeeActive } from "@/modules/issues/server/issue-clothing";
import { preferredUnitCosts } from "@/modules/articles/server/pricing";
import { type Actor, assertCan, assertEmployeeInScope } from "@/server/actor";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { DomainError, invalidState, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import { lockQuotaYears, runInTransaction, type Tx } from "@/server/tx";

/**
 * Kontingentwirkung je Rückgabeart (BDR-5, freigegeben):
 *  RETURN_TO_STOCK  ungetragen zurück ins Lager      → Gutschrift
 *  EXCHANGE         Größentausch                     → Gutschrift (die Ersatzausgabe belastet neu → netto neutral)
 *  DEFECTIVE        Produktionsfehler, Ausschusslager → Gutschrift
 *  WRITE_OFF        verschlissen/verloren            → keine Gutschrift
 */
export function quotaCreditFor(returnType: ReturnType, quantity: number): number {
  return returnType === "WRITE_OFF" ? 0 : quantity;
}

export const RETURN_TYPE_LABEL: Record<ReturnType, string> = {
  RETURN_TO_STOCK: "Rückgabe ins Lager (ungetragen)",
  EXCHANGE: "Umtausch",
  DEFECTIVE: "Reklamation / defekt",
  WRITE_OFF: "Abschreibung (verschlissen/verloren)",
};

export const returnClothingSchema = z.object({
  employeeId: z.string().min(1),
  clientRequestId: z.string().uuid(),
  items: z
    .array(
      z.object({
        issueItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
        returnType: z.enum(["RETURN_TO_STOCK", "DEFECTIVE", "WRITE_OFF"]),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(30),
  /** Pflichtbestätigung bei RETURN_TO_STOCK: Ware ist ungetragen (Hygiene, BDR-5) */
  confirmUnworn: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
});

export async function returnClothing(actor: Actor, rawInput: z.input<typeof returnClothingSchema>) {
  assertCan(actor, "return:create");
  const input = returnClothingSchema.parse(rawInput);
  if (input.items.some((i) => i.returnType === "RETURN_TO_STOCK") && !input.confirmUnworn) {
    throw new DomainError("VALIDATION", "Rückgaben ins Lager sind nur für ungetragene Ware zulässig. Bitte bestätigen.");
  }
  const existing = await db.clothingReturn.findUnique({ where: { clientRequestId: input.clientRequestId } });
  if (existing) return { returnId: existing.id, returnNumber: existing.returnNumber };

  return runInTransaction(async (tx) => {
    const { employee, issueItems } = await loadAndLock(tx, actor, input.employeeId, input.items.map((i) => i.issueItemId));
    await assertReturnable(tx, issueItems, input.items);

    const defaultLocationId = await getDefaultLocationId(tx);
    const defectiveLocation = await tx.inventoryLocation.findFirst({ where: { type: "DEFECTIVE", active: true } });
    const returnNumber = await nextDocumentNumber(tx, "return");

    const ret = await tx.clothingReturn.create({
      data: { returnNumber, employeeId: employee.id, receivedById: actor.userId, clientRequestId: input.clientRequestId, notes: input.notes || null },
    });

    const changes: StockChange[] = [];
    for (const item of input.items) {
      const issueItem = issueItems.get(item.issueItemId)!;
      const locationId =
        item.returnType === "RETURN_TO_STOCK" ? defaultLocationId : item.returnType === "DEFECTIVE" ? (defectiveLocation?.id ?? null) : null;
      await tx.clothingReturnItem.create({
        data: {
          returnId: ret.id,
          issueItemId: issueItem.id,
          quantity: item.quantity,
          returnType: item.returnType,
          quotaCreditQuantity: quotaCreditFor(item.returnType, item.quantity),
          inventoryLocationId: locationId,
          reason: item.reason || null,
        },
      });
      if (locationId) {
        changes.push({
          articleVariantId: issueItem.articleVariantId,
          inventoryLocationId: locationId,
          type: "RETURN",
          physicalDelta: item.quantity,
          referenceType: "CLOTHING_RETURN",
          referenceId: ret.id,
          userId: actor.userId,
          reason: item.reason,
        });
      }
    }
    if (changes.length) await applyStockChanges(tx, changes);

    await audit(tx, {
      actorId: actor.userId,
      action: "CLOTHING_RETURNED",
      entityType: "ClothingReturn",
      entityId: ret.id,
      newValue: { returnNumber, employeeNumber: employee.employeeNumber, items: input.items },
    });
    return { returnId: ret.id, returnNumber };
  });
}

export const exchangeClothingSchema = z.object({
  employeeId: z.string().min(1),
  clientRequestId: z.string().uuid(),
  issueItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  newArticleVariantId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Umtausch (z. B. Hose 52 passt nicht → Hose 54). Eine Transaktion mit zwei physischen Bewegungen
 * (RETURN der alten, ISSUE der neuen Variante). Das Kontingent wird nicht doppelt belastet:
 * Gutschrift der Rückgabe + neue Ausgabe im **selben Kontingentjahr** wie die Originalausgabe.
 */
export async function exchangeClothing(actor: Actor, rawInput: z.input<typeof exchangeClothingSchema>) {
  assertCan(actor, "return:create");
  assertCan(actor, "issue:create");
  const input = exchangeClothingSchema.parse(rawInput);
  const existing = await db.clothingReturn.findUnique({ where: { clientRequestId: input.clientRequestId } });
  if (existing) {
    const issue = await db.clothingIssue.findUniqueOrThrow({ where: { clientRequestId: `${input.clientRequestId}:exchange` } });
    return { returnId: existing.id, returnNumber: existing.returnNumber, issueId: issue.id, issueNumber: issue.issueNumber };
  }

  return runInTransaction(async (tx) => {
    const { employee, issueItems } = await loadAndLock(tx, actor, input.employeeId, [input.issueItemId]);
    assertEmployeeActive(employee);
    const original = issueItems.get(input.issueItemId)!;
    await assertReturnable(tx, issueItems, [{ issueItemId: original.id, quantity: input.quantity }]);

    const newVariant = await tx.articleVariant.findUnique({
      where: { id: input.newArticleVariantId },
      include: { article: true },
    });
    if (!newVariant || !newVariant.active || !newVariant.article.active) throw notFound("Die neue Artikelvariante");
    if (newVariant.article.quotaGroupId !== original.quotaGroupId) {
      throw new DomainError("VALIDATION", "Umtausch ist nur innerhalb derselben Kontingentgruppe möglich.");
    }

    const locationId = await getDefaultLocationId(tx);
    const returnNumber = await nextDocumentNumber(tx, "return");
    const ret = await tx.clothingReturn.create({
      data: { returnNumber, employeeId: employee.id, receivedById: actor.userId, clientRequestId: input.clientRequestId, notes: input.reason || null },
    });
    const returnItem = await tx.clothingReturnItem.create({
      data: {
        returnId: ret.id,
        issueItemId: original.id,
        quantity: input.quantity,
        returnType: "EXCHANGE",
        quotaCreditQuantity: quotaCreditFor("EXCHANGE", input.quantity),
        inventoryLocationId: locationId,
        reason: input.reason || null,
      },
    });

    const issueNumber = await nextDocumentNumber(tx, "issue");
    const unitCosts = await preferredUnitCosts(tx, [newVariant.articleId]);
    const issue = await tx.clothingIssue.create({
      data: {
        issueNumber,
        employeeId: employee.id,
        departmentIdSnapshot: employee.departmentId,
        issuedById: actor.userId,
        clientRequestId: `${input.clientRequestId}:exchange`,
        notes: `Umtausch zu ${returnNumber}`,
        items: {
          create: {
            articleVariantId: newVariant.id,
            inventoryLocationId: locationId,
            quantity: input.quantity,
            quotaGroupId: original.quotaGroupId,
            quotaYear: original.quotaYear,
            quotaRelevant: original.quotaRelevant,
            unitCost: unitCosts.get(newVariant.articleId) ?? null,
            exchangeOfReturnItemId: returnItem.id,
          },
        },
      },
    });

    await applyStockChanges(tx, [
      { articleVariantId: original.articleVariantId, inventoryLocationId: locationId, type: "RETURN", physicalDelta: input.quantity, referenceType: "CLOTHING_RETURN", referenceId: ret.id, userId: actor.userId, reason: "Umtausch" },
      { articleVariantId: newVariant.id, inventoryLocationId: locationId, type: "ISSUE", physicalDelta: -input.quantity, referenceType: "CLOTHING_ISSUE", referenceId: issue.id, userId: actor.userId, reason: "Umtausch" },
    ]);

    await audit(tx, {
      actorId: actor.userId,
      action: "CLOTHING_RETURNED",
      entityType: "ClothingReturn",
      entityId: ret.id,
      newValue: { returnNumber, exchange: true, issueNumber, fromVariantId: original.articleVariantId, toVariantId: newVariant.id, quantity: input.quantity },
      reason: input.reason,
    });
    return { returnId: ret.id, returnNumber, issueId: issue.id, issueNumber };
  });
}

async function loadAndLock(tx: Tx, actor: Actor, employeeId: string, issueItemIds: string[]) {
  const employee = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw notFound("Der Mitarbeiter");
  assertEmployeeInScope(actor, employee);

  const items = await tx.clothingIssueItem.findMany({
    where: { id: { in: issueItemIds } },
    include: { issue: { select: { employeeId: true, status: true } } },
  });
  if (items.length !== new Set(issueItemIds).size || items.some((i) => i.issue.employeeId !== employee.id)) {
    throw notFound("Die Ausgabeposition");
  }
  if (items.some((i) => i.issue.status !== "COMPLETED")) throw invalidState("Die Ausgabe wurde storniert.");

  await lockQuotaYears(tx, [...new Set(items.map((i) => i.quotaYear))].map((year) => ({ employeeId: employee.id, year })));
  return { employee, issueItems: new Map(items.map((i) => [i.id, i])) };
}

/** Summe aller Rückgaben einer Position darf die ausgegebene Menge nicht übersteigen (unter Sperre geprüft). */
async function assertReturnable(
  tx: Tx,
  issueItems: Map<string, { id: string; quantity: number }>,
  requested: Array<{ issueItemId: string; quantity: number }>,
) {
  const already = await tx.clothingReturnItem.groupBy({
    by: ["issueItemId"],
    where: { issueItemId: { in: [...issueItems.keys()] } },
    _sum: { quantity: true },
  });
  const returned = new Map(already.map((a) => [a.issueItemId, a._sum.quantity ?? 0]));
  const requestedSum = new Map<string, number>();
  for (const r of requested) requestedSum.set(r.issueItemId, (requestedSum.get(r.issueItemId) ?? 0) + r.quantity);
  for (const [id, qty] of requestedSum) {
    const item = issueItems.get(id)!;
    const open = item.quantity - (returned.get(id) ?? 0);
    if (qty > open) {
      throw new DomainError("VALIDATION", `Von dieser Ausgabeposition können höchstens noch ${open} Stück zurückgegeben werden.`);
    }
  }
}
