import "server-only";
import { z } from "zod";
import { isDomainError, translateDbError } from "./errors";
import { logger } from "./logger";

/**
 * Einheitliches Ergebnis für Server Actions. Die Oberfläche bekommt nur fachliche Meldungen;
 * technische Fehler werden geloggt und generisch beantwortet.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

export async function runAction<T>(name: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (raw) {
    const e = translateDbError(raw);
    if (e instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of e.issues) {
        const key = issue.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return { ok: false, code: "VALIDATION", error: "Bitte prüfen Sie die Eingaben.", fieldErrors };
    }
    if (isDomainError(e)) {
      if (e.code !== "VALIDATION" && e.code !== "QUOTA_EXCEEDED" && e.code !== "STOCK_INSUFFICIENT") {
        logger.info("action rejected", { action: name, code: e.code, message: e.message });
      }
      return { ok: false, code: e.code, error: e.message };
    }
    // Next.js-Steuerfluss (redirect/notFound) nicht abfangen
    if (raw && typeof raw === "object" && "digest" in raw && typeof (raw as { digest: unknown }).digest === "string" && (raw as { digest: string }).digest.startsWith("NEXT_")) {
      throw raw;
    }
    logger.error("action failed", { action: name, error: raw });
    return { ok: false, code: "INTERNAL", error: "Es ist ein unerwarteter Fehler aufgetreten. Bitte versuchen Sie es erneut." };
  }
}
