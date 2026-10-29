import "server-only";
import { z } from "zod";
import { currentYear, toIsoDateInAppTz, todayDateOnly } from "@/lib/dates";
import { applyStockChanges, getDefaultLocationId, type StockChange } from "@/modules/inventory/server/stock";
import { assertQuotaAvailable } from "@/modules/quotas/server/quota-service";
import { getSetting } from "@/modules/settings/server/settings";
import { type Actor, assertCan, assertEmployeeInScope, can } from "@/server/actor";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { DomainError, forbidden, invalidState, notFound } from "@/server/errors";
import { nextDocumentNumber } from "@/server/numbering";
import { lockQuotaYears, runInTransaction, type Tx } from "@/server/tx";
import { preferredUnitCosts } from "@/modules/articles/server/pricing";

export const issueClothingSchema = z.object({
  employeeId: z.string().min(1),
  clientRequestId: z.string().uuid(),
  items: z
    .array(
      z.object({
        articleVariantId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
        inventoryLocationId: z.string().min(1).optional(),
        /** Ausgabe einer Reservierung (eingetroffene oder direkt verfügbare Ware) */
        reservationId: z.string().min(1).optional(),
      }),
    )
    .min(1, "Mindestens eine Position angeben.")
    .max(30),
  /** Sonderfreigabe über das Kontingent hinaus (BDR-6), nur MANAGER/ADMIN */
  override: z.object({ reason: z.string().trim().min(5, "Bitte eine Begründung (mind. 5 Zeichen) angeben.") }).optional(),
  notes: z.string().trim().max(500).optional(),
});

export type IssueClothingInput = z.input<typeof issueClothingSchema>;
export type IssueClothingResult = { issueId: string; issueNumber: string };

/**
 * Kleidung ausgeben (KONZEPT.md C, E.4, F.2). Alles in einer Transaktion:
 * Kontingent sperren und erneut prüfen, Bestand bedingt abbuchen, Ausgabe + Bewegungen + Audit schreiben.
 */
export async function issueClothing(actor: Actor, rawInput: IssueClothingInput): Promise<IssueClothingResult> {
  assertCan(actor, "issue:create");
  const input = issueClothingSchema.parse(rawInput);
  if (input.override) assertCan(actor, "quota:override");

  const existing = await findByClientRequestId(input.clientRequestId);
  if (existing) return existing;

  try {
    return await runInTransaction((tx) => issueInTx(tx, actor, input));
  } catch (e) {
    // gleichzeitiges doppeltes Absenden: die erste Buchung gewinnt, die zweite liefert deren Ergebnis
    const again = await findByClientRequestId(input.clientRequestId);
    if (again) return again;
    throw e;
  }
}

async function findByClientRequestId(clientRequestId: string): Promise<IssueClothingResult | null> {
  const issue = await db.clothingIssue.findUnique({ where: { clientRequestId }, select: { id: true, issueNumber: true } });
  return issue ? { issueId: issue.id, issueNumber: issue.issueNumber } : null;
}

async function issueInTx(tx: Tx, actor: Actor, input: z.output<typeof issueClothingSchema>): Promise<IssueClothingResult> {
  const employee = await tx.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, firstName: true, lastName: true, employeeNumber: true, departmentId: true, status: true, exitDate: true },
  });
  if (!employee) throw notFound("Der Mitarbeiter");
  assertEmployeeInScope(actor, employee);
  assertEmployeeActive(employee);

  const variantIds = [...new Set(input.items.map((i) => i.articleVariantId))];
  const variants = await tx.articleVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      active: true,
      variantSku: true,
      articleId: true,
      article: { select: { name: true, active: true, quotaGroupId: true, quotaGroup: { select: { isQuotaRelevant: true } } } },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));
  for (const id of variantIds) {
    const v = variantById.get(id);
    if (!v) throw notFound("Die Artikelvariante");
    if (!v.active || !v.article.active) {
      throw new DomainError("ARTICLE_INACTIVE", `Der Artikel „${v.article.name}“ (${v.variantSku}) ist nicht mehr aktiv.`);
    }
  }

  const reservationIds = input.items.flatMap((i) => (i.reservationId ? [i.reservationId] : []));
  if (new Set(reservationIds).size !== reservationIds.length) throw invalidState("Eine Reservierung ist mehrfach enthalten.");
  const reservations = reservationIds.length
    ? await tx.employeeReservation.findMany({ where: { id: { in: reservationIds } } })
    : [];
  const reservationById = new Map(reservations.map((r) => [r.id, r]));

  const year = currentYear();
  const quotaYears = new Set<number>([year, ...reservations.map((r) => r.quotaYear)]);
  await lockQuotaYears(tx, [...quotaYears].map((y) => ({ employeeId: employee.id, year: y })));

  // Reservierungen erst nach der Sperre final prüfen (Status kann sich parallel geändert haben)
  const lockedReservations = reservationIds.length
    ? await tx.employeeReservation.findMany({ where: { id: { in: reservationIds } } })
    : [];
  for (const r of lockedReservations) reservationById.set(r.id, r);

  const defaultLocationId = await getDefaultLocationId(tx);

  type Line = {
    articleVariantId: string;
    quantity: number;
    inventoryLocationId: string;
    quotaGroupId: string;
    quotaYear: number;
    quotaRelevant: boolean;
    reservationId: string | null;
    fromReservedStock: boolean;
  };

  const lines: Line[] = input.items.map((item) => {
    const variant = variantById.get(item.articleVariantId)!;
    if (!item.reservationId) {
      return {
        articleVariantId: item.articleVariantId,
        quantity: item.quantity,
        inventoryLocationId: item.inventoryLocationId ?? defaultLocationId,
        quotaGroupId: variant.article.quotaGroupId,
        quotaYear: year,
        quotaRelevant: variant.article.quotaGroup.isQuotaRelevant,
        reservationId: null,
        fromReservedStock: false,
      };
    }
    const r = reservationById.get(item.reservationId);
    if (!r || r.employeeId !== employee.id) throw notFound("Die Reservierung");
    if (r.articleVariantId !== item.articleVariantId) throw invalidState("Die Reservierung gehört zu einer anderen Artikelvariante.");
    if (r.quantity !== item.quantity) throw invalidState("Eine Reservierung kann nur vollständig ausgegeben werden.");
    if (r.status === "RECEIVED" && r.inventoryLocationId) {
      // eingetroffene, reserviert eingelagerte Ware
      return {
        articleVariantId: r.articleVariantId,
        quantity: r.quantity,
        inventoryLocationId: r.inventoryLocationId,
        quotaGroupId: r.quotaGroupId,
        quotaYear: r.quotaYear,
        quotaRelevant: variant.article.quotaGroup.isQuotaRelevant,
        reservationId: r.id,
        fromReservedStock: true,
      };
    }
    if (r.status === "PENDING") {
      // noch nicht bestellt, Ware inzwischen frei verfügbar: aus freiem Bestand erfüllen
      return {
        articleVariantId: r.articleVariantId,
        quantity: r.quantity,
        inventoryLocationId: item.inventoryLocationId ?? defaultLocationId,
        quotaGroupId: r.quotaGroupId,
        quotaYear: r.quotaYear,
        quotaRelevant: variant.article.quotaGroup.isQuotaRelevant,
        reservationId: r.id,
        fromReservedStock: false,
      };
    }
    if (r.status === "ORDERED") {
      throw invalidState("Die Reservierung ist bereits beim Lieferanten bestellt. Bitte den Wareneingang abwarten oder die Reservierung stornieren.");
    }
    throw invalidState("Die Reservierung ist nicht mehr offen.");
  });

  // Kontingentprüfung nur für neue Verbräuche; Reservierungen haben ihr Kontingent bereits belegt.
  const demand = new Map<string, number>();
  for (const l of lines) {
    if (l.reservationId || !l.quotaRelevant) continue;
    demand.set(l.quotaGroupId, (demand.get(l.quotaGroupId) ?? 0) + l.quantity);
  }

  const overrideAdjustments: Array<{ quotaGroupId: string; delta: number }> = [];
  const intervalOverrides: Array<{ quotaGroupId: string; nextEligibleAt: string }> = [];
  for (const [quotaGroupId, quantity] of demand) {
    try {
      await assertQuotaAvailable(tx, { employeeId: employee.id, year, quotaGroupId, quantity });
    } catch (e) {
      if (!(e instanceof DomainError) || e.code !== "QUOTA_EXCEEDED" || !input.override) throw e;
      // Beim Mindestabstand wird nur der fehlende Jahresanspruch nachgebucht; die Sperre selbst wird protokolliert.
      if (e.details?.nextEligibleAt) intervalOverrides.push({ quotaGroupId, nextEligibleAt: String(e.details.nextEligibleAt) });
      const available = Number(e.details?.availableByCount ?? e.details?.available ?? 0);
      if (quantity > available) overrideAdjustments.push({ quotaGroupId, delta: quantity - available });
    }
  }

  const issueNumber = await nextDocumentNumber(tx, "issue");
  const unitCosts = await preferredUnitCosts(tx, [...new Set(variants.map((v) => v.articleId))]);

  const issue = await tx.clothingIssue.create({
    data: {
      issueNumber,
      employeeId: employee.id,
      departmentIdSnapshot: employee.departmentId,
      issuedById: actor.userId,
      clientRequestId: input.clientRequestId,
      notes: input.notes || null,
      items: {
        create: lines.map((l) => ({
          articleVariantId: l.articleVariantId,
          inventoryLocationId: l.inventoryLocationId,
          quantity: l.quantity,
          quotaGroupId: l.quotaGroupId,
          quotaYear: l.quotaYear,
          quotaRelevant: l.quotaRelevant,
          unitCost: unitCosts.get(variantById.get(l.articleVariantId)!.articleId) ?? null,
          reservationId: l.reservationId,
        })),
      },
    },
    select: { id: true },
  });

  for (const adj of overrideAdjustments) {
    const created = await tx.employeeQuotaAdjustment.create({
      data: {
        employeeId: employee.id,
        quotaGroupId: adj.quotaGroupId,
        year,
        quantityDelta: adj.delta,
        reason: input.override!.reason,
        source: "OVERRIDE",
        relatedIssueId: issue.id,
        createdById: actor.userId,
      },
    });
    await audit(tx, {
      actorId: actor.userId,
      action: "QUOTA_OVERRIDE",
      entityType: "EmployeeQuotaAdjustment",
      entityId: created.id,
      newValue: { employeeId: employee.id, quotaGroupId: adj.quotaGroupId, year, quantityDelta: adj.delta, issueNumber },
      reason: input.override!.reason,
    });
  }

  for (const o of intervalOverrides) {
    await audit(tx, {
      actorId: actor.userId,
      action: "QUOTA_INTERVAL_OVERRIDE",
      entityType: "ClothingIssue",
      entityId: issue.id,
      newValue: { employeeId: employee.id, quotaGroupId: o.quotaGroupId, nextEligibleAt: o.nextEligibleAt, issueNumber },
      reason: input.override!.reason,
    });
  }

  const stockChanges: StockChange[] = lines.map((l) => ({
    articleVariantId: l.articleVariantId,
    inventoryLocationId: l.inventoryLocationId,
    type: "ISSUE",
    physicalDelta: -l.quantity,
    reservedDelta: l.fromReservedStock ? -l.quantity : 0,
    referenceType: "CLOTHING_ISSUE",
    referenceId: issue.id,
    userId: actor.userId,
  }));
  await applyStockChanges(tx, stockChanges);

  for (const l of lines) {
    if (l.reservationId) {
      await tx.employeeReservation.update({ where: { id: l.reservationId }, data: { status: "ISSUED" } });
    }
  }

  await audit(tx, {
    actorId: actor.userId,
    action: "CLOTHING_ISSUED",
    entityType: "ClothingIssue",
    entityId: issue.id,
    newValue: {
      issueNumber,
      employee: { id: employee.id, employeeNumber: employee.employeeNumber },
      items: lines.map((l) => ({
        variantSku: variantById.get(l.articleVariantId)!.variantSku,
        quantity: l.quantity,
        inventoryLocationId: l.inventoryLocationId,
        quotaYear: l.quotaYear,
        reservationId: l.reservationId,
      })),
    },
  });

  return { issueId: issue.id, issueNumber };
}

export function assertEmployeeActive(employee: { status: string; exitDate: Date | null; firstName: string; lastName: string }) {
  if (employee.status !== "ACTIVE") {
    throw new DomainError("EMPLOYEE_INACTIVE", `${employee.firstName} ${employee.lastName} ist nicht aktiv.`);
  }
  if (employee.exitDate && employee.exitDate < todayDateOnly()) {
    throw new DomainError("EMPLOYEE_INACTIVE", `${employee.firstName} ${employee.lastName} ist bereits ausgeschieden.`);
  }
}

// ───────────────────────────── Storno ─────────────────────────────

export const cancelIssueSchema = z.object({
  issueId: z.string().min(1),
  reason: z.string().trim().min(5, "Bitte eine Begründung (mind. 5 Zeichen) angeben.").max(500),
});

/**
 * Storniert eine Ausgabe vollständig (BDR-8): Ware zurück in den freien Bestand, Kontingent wieder frei.
 * - Eine zugehörige Reservierung wird storniert (die Ware ist dann frei verfügbar).
 * - Sonderfreigaben, die für diese Ausgabe angelegt wurden, werden durch Gegenbuchung neutralisiert.
 * - Nicht möglich, wenn bereits Rückgaben zu dieser Ausgabe gebucht wurden.
 */
export async function cancelIssue(actor: Actor, rawInput: z.input<typeof cancelIssueSchema>): Promise<void> {
  const input = cancelIssueSchema.parse(rawInput);

  await runInTransaction(async (tx) => {
    const issue = await tx.clothingIssue.findUnique({
      where: { id: input.issueId },
      include: { items: { include: { returnItems: { select: { id: true } } } }, employee: true, adjustments: true },
    });
    if (!issue) throw notFound("Die Ausgabe");
    assertEmployeeInScope(actor, issue.employee);

    if (!can(actor, "issue:cancelAny")) {
      const sameDayOnly = await getSetting("issue.responsibleCancelSameDayOnly", tx);
      const own = issue.issuedById === actor.userId;
      const sameDay = toIsoDateInAppTz(issue.issuedAt) === toIsoDateInAppTz(new Date());
      if (!can(actor, "issue:cancelOwnSameDay") || !own || (sameDayOnly && !sameDay)) {
        throw forbidden("Sie dürfen nur eigene Ausgaben vom selben Tag stornieren.");
      }
    }

    const years = [...new Set(issue.items.map((i) => i.quotaYear))];
    await lockQuotaYears(tx, years.map((year) => ({ employeeId: issue.employeeId, year })));

    // Status nach der Sperre erneut lesen (paralleles Storno)
    const fresh = await tx.clothingIssue.findUniqueOrThrow({ where: { id: issue.id }, select: { status: true } });
    if (fresh.status !== "COMPLETED") throw invalidState("Die Ausgabe ist bereits storniert.");
    if (issue.items.some((i) => i.returnItems.length > 0)) {
      throw invalidState("Zu dieser Ausgabe wurden bereits Rückgaben gebucht. Bitte stattdessen eine Rückgabe erfassen.");
    }

    await tx.clothingIssue.update({
      where: { id: issue.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: input.reason },
    });

    await applyStockChanges(
      tx,
      issue.items.map((i) => ({
        articleVariantId: i.articleVariantId,
        inventoryLocationId: i.inventoryLocationId,
        type: "ISSUE_CANCELLATION" as const,
        physicalDelta: i.quantity,
        referenceType: "CLOTHING_ISSUE" as const,
        referenceId: issue.id,
        userId: actor.userId,
        reason: input.reason,
      })),
    );

    for (const item of issue.items) {
      if (item.reservationId) {
        await tx.employeeReservation.update({
          where: { id: item.reservationId },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Ausgabe ${issue.issueNumber} storniert: ${input.reason}` },
        });
      }
    }

    for (const adj of issue.adjustments.filter((a) => a.source === "OVERRIDE")) {
      await tx.employeeQuotaAdjustment.create({
        data: {
          employeeId: adj.employeeId,
          quotaGroupId: adj.quotaGroupId,
          year: adj.year,
          quantityDelta: -adj.quantityDelta,
          reason: `Storno Ausgabe ${issue.issueNumber}: Sonderfreigabe aufgehoben`,
          source: "OVERRIDE",
          relatedIssueId: issue.id,
          createdById: actor.userId,
        },
      });
    }

    await audit(tx, {
      actorId: actor.userId,
      action: "CLOTHING_ISSUE_CANCELLED",
      entityType: "ClothingIssue",
      entityId: issue.id,
      oldValue: { status: "COMPLETED" },
      newValue: { status: "CANCELLED", issueNumber: issue.issueNumber },
      reason: input.reason,
    });
  });
}
