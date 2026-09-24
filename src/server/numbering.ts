import "server-only";
import { yearInAppTz } from "@/lib/dates";
import type { Tx } from "./tx";

/**
 * Belegnummern aus PostgreSQL-Sequenzen (lückenarm, kollisionsfrei auch bei parallelen Buchungen).
 * Format: <Präfix>-<Jahr>-<laufende Nummer, 6-stellig>, z. B. A-2026-000042.
 */
const SEQUENCES = {
  issue: { seq: "issue_number_seq", prefix: "A" },
  return: { seq: "return_number_seq", prefix: "R" },
  order: { seq: "order_number_seq", prefix: "B" },
  receipt: { seq: "receipt_number_seq", prefix: "W" },
} as const;

export type DocumentKind = keyof typeof SEQUENCES;

/** `documentDate`: Belegdatum (z. B. bei übernommenen historischen Ausgaben); Standard ist jetzt. */
export async function nextDocumentNumber(tx: Tx, kind: DocumentKind, documentDate: Date = new Date()): Promise<string> {
  const { seq, prefix } = SEQUENCES[kind];
  // Sequenzname stammt aus der Konstante oben, nicht aus Benutzereingaben.
  const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('${seq}') AS n`);
  const n = rows[0]!.n;
  return `${prefix}-${yearInAppTz(documentDate)}-${String(n).padStart(6, "0")}`;
}
