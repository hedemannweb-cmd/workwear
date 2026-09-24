import "server-only";

type Level = "debug" | "info" | "warn" | "error";

/**
 * Minimaler strukturierter Logger (JSON-Zeilen auf stdout/stderr), passend für Docker-Logs.
 * Technische Fehlerdetails landen hier – nie in der Oberfläche.
 */
function log(level: Level, message: string, context?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const entry = { ts: new Date().toISOString(), level, message, ...serialize(context) };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

function serialize(context?: Record<string, unknown>) {
  if (!context) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack, code: (v as { code?: unknown }).code } : v;
  }
  return out;
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => log("debug", m, c),
  info: (m: string, c?: Record<string, unknown>) => log("info", m, c),
  warn: (m: string, c?: Record<string, unknown>) => log("warn", m, c),
  error: (m: string, c?: Record<string, unknown>) => log("error", m, c),
};
