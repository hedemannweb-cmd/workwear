import { execSync } from "node:child_process";
import "dotenv/config";

/** Test-Datenbank einmalig auf den aktuellen Migrationsstand bringen. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL ist nicht gesetzt (siehe .env.example)");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL darf nicht auf die Entwicklungsdatenbank zeigen");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
