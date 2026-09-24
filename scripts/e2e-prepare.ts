/**
 * Bereitet die E2E-Datenbank vor: leert sie und spielt den Demo-Seed ein.
 * Sicherheitsnetz: läuft nur gegen eine Datenbank, deren Name auf "_test" endet.
 */
import { db } from "../src/server/db";
import { seed } from "../prisma/seed";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!url.pathname.endsWith("_test")) throw new Error(`Abbruch: ${url.pathname} ist keine Test-Datenbank (muss auf _test enden).`);
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  for (const seq of ["issue_number_seq", "return_number_seq", "order_number_seq", "receipt_number_seq"]) {
    await db.$executeRawUnsafe(`ALTER SEQUENCE ${seq} RESTART WITH 1`);
  }
  await seed();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
