import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { listCategories } from "@/modules/categories/server/categories";
import { requirePagePermission } from "@/server/actor";
import { CategoriesClient } from "./categories-client";

export const metadata: Metadata = { title: "Kategorien" };

export default async function CategoriesPage() {
  await requirePagePermission("category:manage");
  const { categories, sizeScales } = await listCategories();
  return (
    <>
      <PageHeader
        title="Artikelkategorien"
        description="Kategorien gliedern die Arbeitskleidung und legen die Größenskala fest. Kategorien, an denen noch Artikel hängen, lassen sich nur deaktivieren."
      />
      <CategoriesClient
        sizeScales={sizeScales}
        rows={categories.map((c) => ({
          id: c.id,
          name: c.name,
          sizeScaleId: c.sizeScaleId,
          sizeScale: c.sizeScale?.name ?? null,
          sortOrder: c.sortOrder,
          active: c.active,
          articles: c._count.articles,
          employeeSizes: c._count.employeeSizes,
        }))}
      />
    </>
  );
}
