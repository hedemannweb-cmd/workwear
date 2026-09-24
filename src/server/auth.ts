import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";

/**
 * Authentifizierung mit Better Auth (E-Mail + Passwort, Sessions in PostgreSQL).
 * - Keine Selbstregistrierung: Benutzer legt ausschließlich ein Administrator an (users-Modul).
 * - Deaktivierte Benutzer können sich nicht anmelden; bestehende Sessions werden beim Deaktivieren gelöscht
 *   und zusätzlich bei jedem Request in requireActor() geprüft.
 * - Rate Limiting für die Auth-Endpunkte ist aktiv (auch in der Entwicklung).
 */
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 Stunden
    updateAge: 60 * 60, // Verlängerung höchstens stündlich
  },
  user: {
    additionalFields: {
      role: { type: "string", input: false },
      active: { type: "boolean", input: false },
      restrictedToDepartments: { type: "boolean", input: false },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      // pro IP; Büros mit gemeinsamer IP (NAT) melden sich zu Schichtbeginn gleichzeitig an
      "/sign-in/email": { window: 60, max: Number(process.env.AUTH_SIGNIN_RATE_LIMIT) || 10 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await db.user.findUnique({ where: { id: session.userId }, select: { active: true } });
          if (!user?.active) return false;
          return { data: session };
        },
      },
    },
  },
  plugins: [nextCookies()],
});
