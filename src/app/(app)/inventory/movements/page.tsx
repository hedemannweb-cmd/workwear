import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { listMovements } from "@/modules/inventory/server/queries";
import { requirePagePermission } from "@/server/actor";
import { db } from "@/server/db";
import { MovementsTable } from "./movements-table";

export const metadata: Metadata = { title: "Bewegungsjournal" };

export default async function MovementsPage(props: PageProps<"/inventory/movements">) {
  await requirePagePermission("inventory:view");
  const sp = await props.searchParams;
  const articleId = typeof sp.artikel === "string" ? sp.artikel : undefined;
  const [movements, article] = await Promise.all([
    listMovements({ articleId }),
    articleId ? db.article.findUnique({ where: { id: articleId }, select: { name: true } }) : null,
  ]);
  return (
    <>
      <PageHeader
        title="Bewegungsjournal"
        description={`Jede Lagerbewegung mit Benutzer, Zeitpunkt und Beleg – unveränderlich.${article ? ` Gefiltert: ${article.name}` : " Die letzten 500 Bewegungen."}`}
      />
      <MovementsTable rows={movements} />
    </>
  );
}
