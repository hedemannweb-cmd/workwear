import { z } from "zod";

/**
 * Optionale Begründung (Entscheidung 29.10.2026: keine Pflichtbegründung in der Oberfläche).
 * Fehlt sie, wird ein fester Text gespeichert, damit Audit Log und Journale lesbar bleiben.
 */
export const optionalReason = (fallback: string) =>
  z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || fallback);
