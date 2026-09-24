import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { getArrived, getDemand, listOrders } from "@/modules/orders/server/queries";
import { can, requirePagePermission } from "@/server/actor";
import { db } from "@/server/db";
import { ArrivedTable, DemandPanel, OrdersTable, StockOrderButton } from "./orders-client";

export const metadata: Metadata = { title: "Bestellungen" };

const TABS = [
  ["bedarf", "Bedarf"],
  ["eingetroffen", "Eingetroffen"],
  ["offen", "Offen"],
  ["entwuerfe", "Entwürfe"],
  ["alle", "Alle"],
] as const;

export default async function OrdersPage(props: PageProps<"/orders">) {
  const actor = await requirePagePermission("order:view");
  const sp = await props.searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as (typeof TABS)[number][0]) : "bedarf";

  const [demand, arrived, orders, suppliers] = await Promise.all([
    getDemand(actor),
    getArrived(actor),
    listOrders(),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const counts: Record<string, number> = {
    bedarf: demand.length,
    eingetroffen: arrived.length,
    offen: orders.filter((o) => ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(o.status)).length,
    entwuerfe: orders.filter((o) => o.status === "DRAFT").length,
    alle: orders.length,
  };
  const canManage = can(actor, "order:manage");

  return (
    <>
      <PageHeader
        title="Bestellungen"
        description="Mitarbeiterbedarf sammeln, beim Lieferanten bestellen, Wareneingang buchen."
        actions={canManage && <StockOrderButton suppliers={suppliers} />}
      />
      <nav aria-label="Bereiche" className="flex flex-wrap gap-1 border-b">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/orders?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label} <span className="ml-1 rounded bg-muted px-1.5 text-xs tabular-nums">{counts[key]}</span>
          </Link>
        ))}
      </nav>
      {tab === "bedarf" && <DemandPanel rows={demand} canManage={canManage} />}
      {tab === "eingetroffen" && <ArrivedTable rows={arrived} />}
      {tab === "offen" && <OrdersTable rows={orders.filter((o) => ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(o.status))} />}
      {tab === "entwuerfe" && <OrdersTable rows={orders.filter((o) => o.status === "DRAFT")} />}
      {tab === "alle" && <OrdersTable rows={orders} />}
    </>
  );
}
