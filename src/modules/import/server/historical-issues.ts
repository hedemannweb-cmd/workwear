import "server-only";
import { yearInAppTz } from "@/lib/dates";
import { preferredUnitCosts } from "@/modules/articles/server/pricing";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import type { Tx } from "@/server/tx";

/**
 * Übernahme historischer Ausgaben (Excel-Migration, Vorgabe 29) und Demo-Daten.
 * Historische Ausgaben verändern den heutigen Lagerbestand NICHT – der aktuelle Bestand wird
 * separat als Zählstand übernommen. Das Kontingentjahr ergibt sich aus dem Ausgabedatum.
 * Es gibt bewusst keine Kontingentprüfung: Historie wird so übernommen, wie sie stattgefunden hat.
 */
export async function importHistoricalIssue(
  tx: Tx,
  params: {
    actorId: string;
    employeeId: string;
    issuedAt: Date;
    items: Array<{ articleVariantId: string; quantity: number }>;
    source: string;
    clientRequestId: string;
  },
) {
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: params.employeeId } });
  const history = await tx.employeeDepartmentHistory.findFirst({
    where: { employeeId: employee.id, validFrom: { lte: params.issuedAt }, OR: [{ validTo: null }, { validTo: { gt: params.issuedAt } }] },
  });
  const variants = await tx.articleVariant.findMany({
    where: { id: { in: params.items.map((i) => i.articleVariantId) } },
    include: { article: { include: { quotaGroup: true } } },
  });
  if (variants.length !== new Set(params.items.map((i) => i.articleVariantId)).size) throw new DomainError("VALIDATION", "Unbekannte Artikelvariante.");
  const location = await tx.inventoryLocation.findFirstOrThrow({ where: { isDefault: true } });
  const costs = await preferredUnitCosts(tx, [...new Set(variants.map((v) => v.articleId))]);

  const issueNumber = await nextDocumentNumber(tx, "issue", params.issuedAt);
  const issue = await tx.clothingIssue.create({
    data: {
      issueNumber,
      employeeId: employee.id,
      departmentIdSnapshot: history?.departmentId ?? employee.departmentId,
      issuedAt: params.issuedAt,
      issuedById: params.actorId,
      clientRequestId: params.clientRequestId,
      notes: `Übernahme: ${params.source}`,
      items: {
        create: params.items.map((i) => {
          const v = variants.find((x) => x.id === i.articleVariantId)!;
          return {
            articleVariantId: v.id,
            inventoryLocationId: location.id,
            quantity: i.quantity,
            quotaGroupId: v.article.quotaGroupId,
            quotaYear: yearInAppTz(params.issuedAt),
            quotaRelevant: v.article.quotaGroup.isQuotaRelevant,
            unitCost: costs.get(v.articleId) ?? null,
          };
        }),
      },
    },
  });
  await audit(tx, {
    actorId: params.actorId,
    action: "CLOTHING_ISSUED",
    entityType: "ClothingIssue",
    entityId: issue.id,
    newValue: { issueNumber, historical: true, source: params.source, issuedAt: params.issuedAt },
  });
  return issue;
}
