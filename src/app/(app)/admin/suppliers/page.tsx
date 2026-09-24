import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { listSuppliers } from "@/modules/suppliers/server/suppliers";
import { requirePagePermission } from "@/server/actor";
import { SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Lieferanten" };

export default async function SuppliersPage() {
  await requirePagePermission("supplier:manage");
  const suppliers = await listSuppliers();
  return (
    <>
      <PageHeader title="Lieferanten" description="Artikelzuordnung, Einkaufspreise und Lieferzeiten pflegen Sie am jeweiligen Artikel." />
      <SuppliersClient
        rows={suppliers.map((s) => ({
          id: s.id,
          supplierNumber: s.supplierNumber,
          name: s.name,
          contactPerson: s.contactPerson,
          email: s.email,
          phone: s.phone,
          website: s.website,
          notes: s.notes,
          active: s.active,
          articles: s._count.articles,
          openOrders: s._count.orders,
        }))}
      />
    </>
  );
}
