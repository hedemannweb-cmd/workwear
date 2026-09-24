import { db } from "@/server/db";

/** Healthcheck für Docker: Anwendung läuft und die Datenbank antwortet. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
