/**
 * CSV für Excel (deutsch): Semikolon als Trenner, UTF-8 mit BOM, Werte bei Bedarf in Anführungszeichen.
 * Schutz gegen CSV-/Formel-Injection: Werte, die mit = + - @ beginnen, werden mit ' eingeleitet.
 */
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}
