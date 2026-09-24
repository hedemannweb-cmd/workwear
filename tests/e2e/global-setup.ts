import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import "dotenv/config";

/**
 * Test-Datenbank migrieren und mit Demodaten füllen. Die Test-Benutzer bekommen bei jedem Lauf
 * ein zufälliges Einmal-Passwort – es gibt keine festen Zugangsdaten im Repository.
 */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  const password = `E2e-${randomBytes(9).toString("base64url")}9a`;
  const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_PASSWORD: password, SEED_DEMO_PASSWORD: password };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx --conditions=react-server scripts/e2e-prepare.ts", { env, stdio: "pipe" });
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/.e2e-credentials.json", JSON.stringify({ password }));
}
