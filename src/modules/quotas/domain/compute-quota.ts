import type { EntryRule } from "@/generated/prisma/enums";
import { entitlementForYear } from "./proration";

/**
 * Zentrale Kontingentberechnung, als reine Funktion ohne Datenbankzugriff.
 *
 *   available = base + adjustments − issued − reserved
 *   issued    = Ausgaben (nicht storniert, kontingentrelevant) − Rückgabe-Gutschriften
 *   reserved  = Reservierungen mit Status PENDING | ORDERED | RECEIVED
 *
 * Alle Eingaben beziehen sich auf genau ein Kontingentjahr. Das Laden und Filtern übernimmt
 * der QuotaService; diese Funktion rechnet nur und erzeugt den nachvollziehbaren Nachweis.
 */

export type QuotaGroupInfo = {
  id: string;
  name: string;
  sortOrder: number;
  isQuotaRelevant: boolean;
};

export type QuotaInput = {
  year: number;
  /** YYYY-MM-DD */
  entryDate: string;
  entryRule: EntryRule;
  profile: { code: string; name: string } | null;
  groups: QuotaGroupInfo[];
  /** Jahresanspruch laut gültiger Regel je Gruppe */
  rules: Array<{ quotaGroupId: string; quantityPerYear: number }>;
  adjustments: Array<{ id: string; quotaGroupId: string; quantityDelta: number; date: Date; reason: string; source: string }>;
  issues: Array<{ issueId: string; issueNumber: string; quotaGroupId: string; quantity: number; date: Date; label: string }>;
  returnCredits: Array<{ returnId: string; returnNumber: string; quotaGroupId: string; credit: number; date: Date; label: string }>;
  reservations: Array<{ id: string; quotaGroupId: string; quantity: number; date: Date; status: string; label: string }>;
  /** Gruppen, die auch ohne Regel oder Buchung als Zeile erscheinen sollen (z. B. für eine Prüfung) */
  includeGroupIds?: string[];
};

export type QuotaLedgerEntry = {
  date: Date | null;
  kind: "BASE" | "ADJUSTMENT" | "ISSUE" | "RETURN_CREDIT" | "RESERVATION";
  /** Wirkung auf das verfügbare Kontingent (Anspruch/Anpassung positiv, Verbrauch negativ) */
  effect: number;
  label: string;
  referenceId?: string;
};

export type QuotaLine = {
  quotaGroupId: string;
  quotaGroupName: string;
  year: number;
  quotaRelevant: boolean;
  base: number;
  baseExplanation: string;
  adjustments: number;
  issued: number;
  reserved: number;
  /** nie negativ; bei nicht kontingentrelevanten Gruppen null (= unbegrenzt) */
  available: number | null;
  /** true, wenn mehr verbraucht/reserviert ist als Anspruch + Anpassungen (z. B. nach Abteilungswechsel) */
  overdrawn: boolean;
  ledger: QuotaLedgerEntry[];
};

export function computeQuota(input: QuotaInput): QuotaLine[] {
  const ruleByGroup = new Map(input.rules.map((r) => [r.quotaGroupId, r.quantityPerYear]));

  // Gruppen anzeigen, für die es eine Regel oder irgendeine Buchung im Jahr gibt.
  const relevantGroupIds = new Set<string>([
    ...input.rules.map((r) => r.quotaGroupId),
    ...input.adjustments.map((a) => a.quotaGroupId),
    ...input.issues.map((i) => i.quotaGroupId),
    ...input.returnCredits.map((c) => c.quotaGroupId),
    ...input.reservations.map((r) => r.quotaGroupId),
    ...(input.includeGroupIds ?? []),
  ]);

  const lines = input.groups
    .filter((g) => relevantGroupIds.has(g.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "de"))
    .map((group) => computeLine(input, group, ruleByGroup.get(group.id)));

  return lines;
}

function computeLine(input: QuotaInput, group: QuotaGroupInfo, ruleQuantity: number | undefined): QuotaLine {
  const ledger: QuotaLedgerEntry[] = [];

  let base = 0;
  let baseExplanation: string;
  if (ruleQuantity === undefined) {
    baseExplanation = input.profile
      ? `Keine Regel im Profil ${input.profile.code} für ${input.year}`
      : "Der Abteilung ist kein Kontingentprofil zugeordnet";
  } else {
    const ent = entitlementForYear({
      base: ruleQuantity,
      year: input.year,
      entryDate: input.entryDate,
      entryRule: input.entryRule,
    });
    base = ent.quantity;
    baseExplanation = input.profile ? `Profil ${input.profile.code}: ${ent.explanation}` : ent.explanation;
  }
  ledger.push({ date: null, kind: "BASE", effect: base, label: `Grundkontingent – ${baseExplanation}` });

  let adjustments = 0;
  for (const a of input.adjustments.filter((x) => x.quotaGroupId === group.id)) {
    adjustments += a.quantityDelta;
    ledger.push({
      date: a.date,
      kind: "ADJUSTMENT",
      effect: a.quantityDelta,
      label: `${a.source === "OVERRIDE" ? "Sonderfreigabe" : "Anpassung"}: ${a.reason}`,
      referenceId: a.id,
    });
  }

  let issued = 0;
  for (const i of input.issues.filter((x) => x.quotaGroupId === group.id)) {
    issued += i.quantity;
    ledger.push({ date: i.date, kind: "ISSUE", effect: -i.quantity, label: i.label, referenceId: i.issueId });
  }
  for (const c of input.returnCredits.filter((x) => x.quotaGroupId === group.id)) {
    if (c.credit === 0) continue;
    issued -= c.credit;
    ledger.push({ date: c.date, kind: "RETURN_CREDIT", effect: c.credit, label: c.label, referenceId: c.returnId });
  }

  let reserved = 0;
  for (const r of input.reservations.filter((x) => x.quotaGroupId === group.id)) {
    reserved += r.quantity;
    ledger.push({ date: r.date, kind: "RESERVATION", effect: -r.quantity, label: r.label, referenceId: r.id });
  }

  ledger.sort((a, b) => {
    if (a.date === null) return -1;
    if (b.date === null) return 1;
    return a.date.getTime() - b.date.getTime();
  });

  const raw = base + adjustments - issued - reserved;
  return {
    quotaGroupId: group.id,
    quotaGroupName: group.name,
    year: input.year,
    quotaRelevant: group.isQuotaRelevant,
    base,
    baseExplanation,
    adjustments,
    issued,
    reserved,
    available: group.isQuotaRelevant ? Math.max(0, raw) : null,
    overdrawn: group.isQuotaRelevant && raw < 0,
    ledger,
  };
}

/** Wie viel darf zusätzlich verbraucht werden? Unbegrenzt bei nicht kontingentrelevanten Gruppen. */
export function remainingFor(line: QuotaLine | undefined): number {
  if (!line) return 0;
  if (!line.quotaRelevant) return Number.POSITIVE_INFINITY;
  return line.available ?? 0;
}
