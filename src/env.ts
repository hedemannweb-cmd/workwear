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
  // Mailversand (optional). Ohne SMTP_HOST werden keine Mails verschickt.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().default(587)),
  /** true = TLS ab Verbindungsaufbau (Port 465), false = STARTTLS */
  SMTP_SECURE: z.enum(["true", "false", ""]).default("false").transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
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
