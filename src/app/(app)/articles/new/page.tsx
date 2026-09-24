import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { articleFormOptions } from "@/modules/articles/server/articles";
import { requirePagePermission } from "@/server/actor";
import { ArticleForm } from "../article-form";

export const metadata: Metadata = { title: "Neuer Artikel" };

export default async function NewArticlePage() {
  await requirePagePermission("article:manage");
  const { categories, groups } = await articleFormOptions();
  return (
    <>
      <PageHeader title="Neuer Artikel" description="Varianten (Größen/Farben) und Lieferanten legen Sie danach auf der Artikelseite an." />
      <div className="max-w-3xl">
        <ArticleForm
          id={null}
          categories={categories.map((c) => ({ id: c.id, name: c.name, scale: c.sizeScale?.name ?? null }))}
          groups={groups}
          defaults={{ sku: "", name: "", description: null, categoryId: "", quotaGroupId: "", manufacturer: null, imageUrl: null, isStockItem: true, active: true }}
        />
      </div>
    </>
  );
}
