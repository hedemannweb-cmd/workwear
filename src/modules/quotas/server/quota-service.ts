import "server-only";
import { currentYear, isoFromDateOnly, toIsoDateInAppTz } from "@/lib/dates";
import { getSetting } from "@/modules/settings/server/settings";
import { db } from "@/server/db";
import { DomainError, notFound } from "@/server/errors";
import type { Tx } from "@/server/tx";
import { computeQuota, remainingFor, type QuotaLine } from "../domain/compute-quota";

/** Reservierungen in diesen Status belasten das Kontingent. */
export const ACTIVE_RESERVATION_STATUSES = ["PENDING", "ORDERED", "RECEIVED"] as const;

type Client = Tx | typeof db;

/**
 * Stichtag für die Abteilungszuordnung eines Kontingentjahres (BDR-3):
 * vergangenes Jahr → 31.12., laufendes Jahr → heute, künftiges Jahr → 01.01.
 */
export function referenceDateForYear(year: number, now: Date = new Date()): string {
  const thisYear = currentYear(now);
  if (year < thisYear) return `${year}-12-31`;
  if (year > thisYear) return `${year}-01-01`;
  return toIsoDateInAppTz(now);
}

async function departmentAt(client: Client, employeeId: string, fallbackDepartmentId: string, isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const row = await client.employeeDepartmentHistory.findFirst({
    where: { employeeId, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gt: date } }] },
    select: { departmentId: true },
  });
  return row?.departmentId ?? fallbackDepartmentId;
}

/**
 * Zentrale Kontingentabfrage. Alle Stellen der Anwendung (Seiten, Prüfungen in Domänenprozessen,
 * Schnellansicht, Auswertungen) verwenden diese Funktion. Innerhalb einer Schreibtransaktion wird
 * `tx` übergeben, damit die Prüfung unter der Kontingentsperre auf dem aktuellen Stand rechnet.
 */
export async function getEmployeeQuota(
  employeeId: string,
  year: number,
  options: { tx?: Tx; includeGroupIds?: string[] } = {},
): Promise<QuotaLine[]> {
  const client: Client = options.tx ?? db;

  const employee = await client.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, entryDate: true, departmentId: true },
  });
  if (!employee) throw notFound("Der Mitarbeiter");

  const departmentId = await departmentAt(client, employee.id, employee.departmentId, referenceDateForYear(year));
  const department = await client.department.findUnique({
    where: { id: departmentId },
    select: { quotaProfile: { select: { id: true, code: true, name: true, entryRule: true } } },
  });
  const profile = department?.quotaProfile ?? null;

  // Innerhalb einer Transaktion teilen sich alle Abfragen eine Verbindung → nacheinander ausführen.
  const run = <T extends readonly (() => Promise<unknown>)[]>(tasks: T) =>
    (options.tx ? sequential(tasks) : Promise.all(tasks.map((t) => t()))) as Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;

  const [globalEntryRule, rules, groups, adjustments, issueItems, returnItems, reservations] = await run([
    () => getSetting("quota.entryRule", client),
    () => profile
      ? client.quotaRule.findMany({
          where: {
            quotaProfileId: profile.id,
            validFromYear: { lte: year },
            OR: [{ validToYear: null }, { validToYear: { gte: year } }],
          },
          orderBy: { validFromYear: "desc" },
          select: { quotaGroupId: true, quantityPerYear: true },
        })
      : Promise.resolve([]),
    () => client.quotaGroup.findMany({ select: { id: true, name: true, sortOrder: true, isQuotaRelevant: true } }),
    () => client.employeeQuotaAdjustment.findMany({
      where: { employeeId, year },
      select: { id: true, quotaGroupId: true, quantityDelta: true, createdAt: true, reason: true, source: true },
    }),
    () => client.clothingIssueItem.findMany({
      where: { quotaYear: year, quotaRelevant: true, issue: { employeeId, status: "COMPLETED" } },
      select: {
        quotaGroupId: true,
        quantity: true,
        issue: { select: { id: true, issueNumber: true, issuedAt: true } },
        articleVariant: { select: { color: true, article: { select: { name: true } }, size: { select: { value: true } } } },
      },
    }),
    () => client.clothingReturnItem.findMany({
      where: { quotaCreditQuantity: { gt: 0 }, issueItem: { quotaYear: year, quotaRelevant: true, issue: { employeeId, status: "COMPLETED" } } },
      select: {
        quotaCreditQuantity: true,
        returnType: true,
        issueItem: { select: { quotaGroupId: true } },
        return: { select: { id: true, returnNumber: true, returnedAt: true } },
      },
    }),
    () => client.employeeReservation.findMany({
      where: { employeeId, quotaYear: year, status: { in: [...ACTIVE_RESERVATION_STATUSES] } },
      select: {
        id: true,
        quotaGroupId: true,
        quantity: true,
        createdAt: true,
        status: true,
        articleVariant: { select: { color: true, article: { select: { name: true } }, size: { select: { value: true } } } },
      },
    }),
  ] as const);

  // Pro Gruppe gilt die Regel mit dem jüngsten validFromYear (Liste ist absteigend sortiert).
  const effectiveRules = new Map<string, number>();
  for (const r of rules) if (!effectiveRules.has(r.quotaGroupId)) effectiveRules.set(r.quotaGroupId, r.quantityPerYear);

  const variantLabel = (v: { color: string | null; article: { name: string }; size: { value: string } | null }) =>
    [v.article.name, v.color, v.size?.value].filter(Boolean).join(" ");

  const RESERVATION_STATUS_LABEL: Record<string, string> = { PENDING: "offen", ORDERED: "bestellt", RECEIVED: "eingetroffen" };
  const RETURN_LABEL: Record<string, string> = {
    RETURN_TO_STOCK: "Rückgabe",
    EXCHANGE: "Umtausch",
    DEFECTIVE: "Reklamation",
    WRITE_OFF: "Abschreibung",
  };

  return computeQuota({
    year,
    entryDate: isoFromDateOnly(employee.entryDate),
    entryRule: profile?.entryRule ?? globalEntryRule,
    profile: profile ? { code: profile.code, name: profile.name } : null,
    groups,
    rules: [...effectiveRules].map(([quotaGroupId, quantityPerYear]) => ({ quotaGroupId, quantityPerYear })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      quotaGroupId: a.quotaGroupId,
      quantityDelta: a.quantityDelta,
      date: a.createdAt,
      reason: a.reason,
      source: a.source,
    })),
    issues: issueItems.map((i) => ({
      issueId: i.issue.id,
      issueNumber: i.issue.issueNumber,
      quotaGroupId: i.quotaGroupId,
      quantity: i.quantity,
      date: i.issue.issuedAt,
      label: `Ausgabe ${i.issue.issueNumber}: ${i.quantity} × ${variantLabel(i.articleVariant)}`,
    })),
    returnCredits: returnItems.map((r) => ({
      returnId: r.return.id,
      returnNumber: r.return.returnNumber,
      quotaGroupId: r.issueItem.quotaGroupId,
      credit: r.quotaCreditQuantity,
      date: r.return.returnedAt,
      label: `${RETURN_LABEL[r.returnType]} ${r.return.returnNumber}: Gutschrift ${r.quotaCreditQuantity}`,
    })),
    reservations: reservations.map((r) => ({
      id: r.id,
      quotaGroupId: r.quotaGroupId,
      quantity: r.quantity,
      date: r.createdAt,
      status: r.status,
      label: `Reservierung (${RESERVATION_STATUS_LABEL[r.status]}): ${r.quantity} × ${variantLabel(r.articleVariant)}`,
    })),
    includeGroupIds: options.includeGroupIds,
  });
}

/**
 * Prüft unter bereits gehaltener Kontingentsperre, ob `quantity` Stück der Gruppe verbraucht werden dürfen.
 * Wirft QUOTA_EXCEEDED mit verständlicher Meldung.
 */
export async function assertQuotaAvailable(
  tx: Tx,
  params: { employeeId: string; year: number; quotaGroupId: string; quantity: number },
): Promise<QuotaLine> {
  const lines = await getEmployeeQuota(params.employeeId, params.year, { tx, includeGroupIds: [params.quotaGroupId] });
  const line = lines.find((l) => l.quotaGroupId === params.quotaGroupId)!;
  const remaining = remainingFor(line);
  if (params.quantity > remaining) {
    throw new DomainError(
      "QUOTA_EXCEEDED",
      remaining === 0
        ? `Das Kontingent „${line.quotaGroupName}“ für ${params.year} ist ausgeschöpft.`
        : `Das Kontingent „${line.quotaGroupName}“ für ${params.year} reicht nicht: ${remaining} verfügbar, ${params.quantity} angefordert.`,
      { available: remaining, requested: params.quantity, quotaGroupId: params.quotaGroupId },
    );
  }
  return line;
}

async function sequential(tasks: readonly (() => Promise<unknown>)[]): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results;
}
