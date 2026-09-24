import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { listGoodsReceipts, listOrders } from "@/modules/orders/server/queries";
import { requirePagePermission } from "@/server/actor";

export const metadata: Metadata = { title: "Wareneingang" };

export default async function GoodsReceiptsPage() {
  await requirePagePermission("goodsReceipt:create");
  const [receipts, orders] = await Promise.all([listGoodsReceipts(), listOrders()]);
  const open = orders.filter((o) => ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(o.status));
  return (
    <>
      <PageHeader title="Wareneingang" description="Ware wird immer gegen eine Bestellung gebucht – Teillieferungen sind möglich." />
      <section className="space-y-2">
        <h2 className="font-medium">Erwartete Lieferungen</h2>
        {open.length === 0 ? (
          <EmptyState title="Keine offenen Bestellungen" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bestellung</TableHead>
                  <TableHead>Lieferant</TableHead>
                  <TableHead>Liefertermin</TableHead>
                  <TableHead className="text-right">Geliefert / Bestellt</TableHead>
                  <TableHead className="w-40">
                    <span className="sr-only">Aktion</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.orderNumber}</TableCell>
                    <TableCell>{o.supplier}</TableCell>
                    <TableCell className={o.overdue ? "font-medium text-danger-foreground" : undefined}>
                      {formatDate(o.expectedDeliveryDate)} {o.overdue && "(überfällig)"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.received} / {o.ordered}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" asChild>
                        <Link href={`/orders/${o.id}`}>Wareneingang buchen</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Gebuchte Wareneingänge</h2>
        {receipts.length === 0 ? (
          <EmptyState title="Noch keine Wareneingänge" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Beleg</TableHead>
                  <TableHead>Zeitpunkt</TableHead>
                  <TableHead>Lieferant</TableHead>
                  <TableHead>Bestellung</TableHead>
                  <TableHead>Lieferschein</TableHead>
                  <TableHead className="text-right">Stück</TableHead>
                  <TableHead>Gebucht von</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.receiptNumber}</TableCell>
                    <TableCell>{formatDateTime(r.receivedAt)}</TableCell>
                    <TableCell>{r.supplier}</TableCell>
                    <TableCell>
                      {r.order ? (
                        <Link href={`/orders/${r.order.id}`} className="hover:underline">
                          {r.order.orderNumber}
                        </Link>
                      ) : (
                        "–"
                      )}
                    </TableCell>
                    <TableCell>{r.deliveryNoteNumber ?? "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell>{r.receivedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
