/**
 * Fachliche Fehler. Jeder Code hat eine verständliche deutsche Meldung; technische Details
 * (Prisma-Codes, Stacktraces) werden nur serverseitig geloggt und nie an die Oberfläche gegeben.
 */
export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "EMPLOYEE_INACTIVE"
  | "ARTICLE_INACTIVE"
  | "QUOTA_EXCEEDED"
  | "STOCK_INSUFFICIENT"
  | "INVALID_STATE"
  | "REASON_REQUIRED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export const forbidden = (message = "Für diese Aktion fehlt die Berechtigung.") =>
  new DomainError("FORBIDDEN", message);

export const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} wurde nicht gefunden.`);

export const invalidState = (message: string) => new DomainError("INVALID_STATE", message);

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

type PrismaLikeError = { code?: string; meta?: { target?: unknown; modelName?: string; driverAdapterError?: unknown } };

/** Bekannte Unique-Constraints → verständliche Meldung. */
const UNIQUE_MESSAGES: Array<[RegExp, string]> = [
  [/employeeNumber/i, "Diese Personalnummer wird bereits verwendet."],
  [/sku|variantSku/i, "Diese Artikelnummer (SKU) wird bereits verwendet."],
  [/barcode/i, "Dieser Barcode ist bereits einer anderen Variante zugeordnet."],
  [/email/i, "Diese E-Mail-Adresse wird bereits verwendet."],
  [/supplierNumber/i, "Diese Lieferantennummer wird bereits verwendet."],
  [/code/i, "Dieser Code wird bereits verwendet."],
  [/name/i, "Dieser Name wird bereits verwendet."],
  [/validFromYear/i, "Für dieses Profil, diese Gruppe und dieses Jahr existiert bereits eine Regel."],
];

/**
 * Übersetzt bekannte Datenbankfehler in DomainErrors. Unbekannte Fehler werden unverändert
 * zurückgegeben und später generisch behandelt.
 */
export function translateDbError(e: unknown): unknown {
  if (isDomainError(e)) return e;
  const err = e as PrismaLikeError & { message?: string };
  if (err?.code === "P2002") {
    const target = JSON.stringify(err.meta ?? {}) + (err.message ?? "");
    const hit = UNIQUE_MESSAGES.find(([re]) => re.test(target));
    return new DomainError("CONFLICT", hit?.[1] ?? "Dieser Datensatz existiert bereits.");
  }
  if (err?.code === "P2003") {
    return new DomainError("CONFLICT", "Der Datensatz wird noch verwendet oder verweist auf einen unbekannten Eintrag.");
  }
  if (err?.code === "P2025") {
    return new DomainError("NOT_FOUND", "Der Datensatz wurde nicht gefunden.");
  }
  const msg = err?.message ?? "";
  if (/check constraint|violates check/i.test(msg)) {
    if (/inventory_/i.test(msg)) {
      return new DomainError("STOCK_INSUFFICIENT", "Der Lagerbestand reicht für diese Buchung nicht aus.");
    }
    return new DomainError("VALIDATION", "Die Eingabe verletzt eine Geschäftsregel.");
  }
  return e;
}
