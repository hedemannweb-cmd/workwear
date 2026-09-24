const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const int = new Intl.NumberFormat("de-DE");

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "–";
  return eur.format(typeof value === "string" ? Number(value) : value);
}

export function formatNumber(value: number): string {
  return int.format(value);
}

/** Vorzeichen immer anzeigen (+1 / −2 / 0), für Anpassungen und Bewegungen. */
export function formatSigned(value: number): string {
  if (value > 0) return `+${int.format(value)}`;
  if (value < 0) return `−${int.format(Math.abs(value))}`;
  return "0";
}

export function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`;
}
