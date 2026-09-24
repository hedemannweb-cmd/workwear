import type { EntryRule } from "@/generated/prisma/enums";

/**
 * Anspruch im Eintrittsjahr (BDR-4, freigegeben am 24.09.2026).
 *
 * PRORATED:
 *   Monate    = 12 − Eintrittsmonat + 1     (der Eintrittsmonat zählt voll)
 *   Anspruch  = kaufmännisch gerundet (Basis × Monate / 12), .5 wird aufgerundet
 *   Mindestens 1, wenn die Basis ≥ 1 ist.
 * FULL:    voller Jahresanspruch.
 * MANUAL:  0 – ein Administrator vergibt den Anspruch über eine individuelle Anpassung.
 *
 * Ein Austritt im laufenden Jahr kürzt den Anspruch nicht.
 * Liegt der Eintritt nach dem betrachteten Jahr, ist der Anspruch 0; liegt er davor, gilt die volle Basis.
 */
export type EntitlementResult = {
  quantity: number;
  explanation: string;
};

export function entitlementForYear(params: {
  base: number;
  year: number;
  /** Eintrittsdatum als YYYY-MM-DD */
  entryDate: string;
  entryRule: EntryRule;
}): EntitlementResult {
  const { base, year, entryDate, entryRule } = params;
  const entryYear = Number(entryDate.slice(0, 4));
  const entryMonth = Number(entryDate.slice(5, 7));

  if (entryYear > year) {
    return { quantity: 0, explanation: `Eintritt erst am ${formatIso(entryDate)}: kein Anspruch in ${year}` };
  }
  if (entryYear < year || base === 0) {
    return { quantity: base, explanation: `Jahresanspruch ${base}` };
  }

  switch (entryRule) {
    case "FULL":
      return { quantity: base, explanation: `Eintritt ${formatIso(entryDate)}, voller Jahresanspruch (FULL): ${base}` };
    case "MANUAL":
      return {
        quantity: 0,
        explanation: `Eintritt ${formatIso(entryDate)}, Anspruch im Eintrittsjahr wird manuell vergeben (MANUAL)`,
      };
    case "PRORATED": {
      const months = 12 - entryMonth + 1;
      const rounded = roundHalfUpFraction(base * months, 12);
      const quantity = base >= 1 ? Math.max(1, rounded) : rounded;
      const exact = ((base * months) / 12).toLocaleString("de-DE", { maximumFractionDigits: 2 });
      const minNote = quantity !== rounded ? ", Mindestanspruch 1" : "";
      return {
        quantity,
        explanation: `Eintritt ${formatIso(entryDate)}, anteilig ${months}/12 von ${base} = ${exact} → ${quantity}${minNote}`,
      };
    }
  }
}

/** round(numerator / denominator) mit Aufrunden bei genau .5, rein ganzzahlig (keine Float-Fehler). */
function roundHalfUpFraction(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

function formatIso(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
