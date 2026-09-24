import { z } from "zod";

/**
 * Serverseitige Environment Variables, beim ersten Zugriff validiert.
 * Secrets kommen ausschließlich aus der Umgebung (.env lokal, Docker-Env in Produktion).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET muss mindestens 32 Zeichen lang sein"),
  BETTER_AUTH_URL: z.url(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Ungültige Umgebungskonfiguration – ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
