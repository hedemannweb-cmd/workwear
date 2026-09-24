import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { listArticles } from "@/modules/articles/server/articles";
import { can, requirePagePermission } from "@/server/actor";
import { ArticlesTable } from "./articles-table";

export const metadata: Metadata = { title: "Arbeitskleidung" };

export default async function ArticlesPage() {
  const actor = await requirePagePermission("inventory:view");
  const articles = await listArticles();
  return (
    <>
      <PageHeader
        title="Arbeitskleidung"
        description="Artikel, Varianten (Größe/Farbe), Lieferanten und Bestände"
        actions={
          can(actor, "article:manage") && (
            <Button asChild>
              <Link href="/articles/new">
                <Plus className="size-4" /> Neuer Artikel
              </Link>
            </Button>
          )
        }
      />
      <ArticlesTable
        rows={articles.map((a) => ({
          id: a.id,
          sku: a.sku,
          name: a.name,
          category: a.category.name,
          quotaGroup: a.quotaGroup.name,
          supplier: a.suppliers[0]?.supplier.name ?? null,
          price: a.suppliers[0]?.purchasePrice?.toString() ?? null,
          variants: a.variants.filter((v) => v.active).length,
          free: a.physical - a.reserved,
          reserved: a.reserved,
          belowMin: a.belowMin,
          active: a.active,
        }))}
      />
    </>
  );
}
