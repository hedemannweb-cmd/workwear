import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { articleFormOptions, getArticle } from "@/modules/articles/server/articles";
import { can, requirePagePermission } from "@/server/actor";
import { isDomainError } from "@/server/errors";
import { ArticleDetailClient } from "./article-detail-client";

export const metadata: Metadata = { title: "Artikel" };

export default async function ArticlePage(props: PageProps<"/articles/[id]">) {
  const actor = await requirePagePermission("inventory:view");
  const { id } = await props.params;
  const article = await getArticle(id).catch((e) => {
    if (isDomainError(e)) notFound();
    throw e;
  });
  const options = await articleFormOptions();
  const canManage = can(actor, "article:manage");

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {article.name}
            {article.active ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Inaktiv</StatusBadge>}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              SKU <span className="font-medium text-foreground">{article.sku}</span>
            </span>
            <Badge variant="secondary">{article.category.name}</Badge>
            <span>Kontingentgruppe: {article.quotaGroup.name}</span>
            {article.manufacturer && <span>Hersteller: {article.manufacturer}</span>}
          </span>
        }
      />
      <ArticleDetailClient
        canManage={canManage}
        article={{
          id: article.id,
          sku: article.sku,
          name: article.name,
          description: article.description,
          categoryId: article.categoryId,
          quotaGroupId: article.quotaGroupId,
          manufacturer: article.manufacturer,
          imageUrl: article.imageUrl,
          isStockItem: article.isStockItem,
          active: article.active,
        }}
        scaleSizes={article.category.sizeScale?.sizes.map((s) => ({ id: s.id, value: s.value })) ?? []}
        variants={article.variants.map((v) => {
          const physical = v.inventory.reduce((s, i) => s + (i.inventoryLocation.type === "STORAGE" ? i.physicalQuantity : 0), 0);
          const reserved = v.inventory.reduce((s, i) => s + (i.inventoryLocation.type === "STORAGE" ? i.reservedQuantity : 0), 0);
          return {
            id: v.id,
            variantSku: v.variantSku,
            size: v.size?.value ?? null,
            color: v.color,
            barcode: v.barcode,
            minStock: v.minStock,
            active: v.active,
            physical,
            reserved,
            free: physical - reserved,
          };
        })}
        suppliers={article.suppliers.map((s) => ({
          supplierId: s.supplierId,
          name: s.supplier.name,
          supplierSku: s.supplierSku,
          purchasePrice: s.purchasePrice === null ? null : Number(s.purchasePrice),
          leadTimeDays: s.leadTimeDays,
          isPreferred: s.isPreferred,
        }))}
        options={{
          categories: options.categories.map((c) => ({ id: c.id, name: c.name, scale: c.sizeScale?.name ?? null })),
          groups: options.groups.map((g) => ({ id: g.id, name: g.name })),
          suppliers: options.suppliers,
        }}
      />
    </>
  );
}
