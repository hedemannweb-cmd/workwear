import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ORDER_STATUS, RESERVATION_STATUS, StatusBadge, StatusOf } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { getOrder } from "@/modules/orders/server/queries";
import { can, requirePagePermission } from "@/server/actor";
import { isDomainError } from "@/server/errors";
import { OrderActions } from "./order-actions";

export const metadata: Metadata = { title: "Bestellung" };

export default async function OrderPage(props: PageProps<"/orders/[id]">) {
  const actor = await requirePagePermission("order:view");
  const { id } = await props.params;
  const order = await getOrder(id).catch((e) => {
    if (isDomainError(e)) notFound();
    throw e;
  });
  const total = order.items.reduce((s, i) => s + i.quantityOrdered * i.unitPrice, 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Bestellung {order.orderNumber}
            <StatusOf map={ORDER_STATUS} status={order.status} />
            {order.overdue && <StatusBadge tone="danger">überfällig</StatusBadge>}
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Lieferant: <span className="font-medium text-foreground">{order.supplier.name}</span>
              {order.supplier.email && ` · ${order.supplier.email}`}
            </span>
            <span>Bestellt: {formatDate(order.orderDate)}</span>
            <span>Liefertermin: {formatDate(order.expectedDeliveryDate)}</span>
            <span>
              Angelegt von {order.createdBy} am {formatDate(order.createdAt)}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/orders/${order.id}/csv`} download>
                <Download className="size-4" /> CSV für Lieferant
              </a>
            </Button>
            <OrderActions
              order={order}
              perms={{ manage: can(actor, "order:manage"), cancel: can(actor, "order:cancel"), receive: can(actor, "goodsReceipt:create") }}
            />
          </>
        }
      />
      {order.cancelReason && (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm">
          Storniert: {order.cancelReason}
        </p>
      )}
      {order.notes && <p className="text-sm text-muted-foreground">Notiz: {order.notes}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Positionen</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artikel</TableHead>
                <TableHead>Lief.-Art.-Nr.</TableHead>
                <TableHead className="text-right">Bestellt</TableHead>
                <TableHead className="text-right">Geliefert</TableHead>
                <TableHead className="text-right">Offen</TableHead>
                <TableHead className="text-right">EK</TableHead>
                <TableHead className="text-right">Summe</TableHead>
                <TableHead>Für Mitarbeiter</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((i) => {
                const forEmployees = i.reservations.filter((r) => r.status !== "CANCELLED");
                const stockQty = i.quantityOrdered - forEmployees.reduce((s, r) => s + r.quantity, 0);
                return (
                  <TableRow key={i.id} className="align-top">
                    <TableCell>
                      <Link href={`/articles/${i.articleId}`} className="font-medium hover:underline">
                        {i.label}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{i.sku}</div>
                    </TableCell>
                    <TableCell className="text-sm">{i.supplierSku ?? "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.quantityOrdered}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.quantityReceived}</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.max(0, i.quantityOrdered - i.quantityReceived)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(i.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(i.unitPrice * i.quantityOrdered)}</TableCell>
                    <TableCell>
                      <ul className="space-y-0.5 text-sm">
                        {forEmployees.map((r) => (
                          <li key={r.id} className="flex items-center gap-2">
                            <span className="tabular-nums">{r.quantity} ×</span>
                            <Link href={`/employees/${r.employee.id}`} className="hover:underline">
                              {r.employee.name}
                            </Link>
                            <StatusOf map={RESERVATION_STATUS} status={r.status} />
                          </li>
                        ))}
                        {stockQty > 0 && <li className="text-muted-foreground">{stockQty} × Lagerware</li>}
                      </ul>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6}>Bestellwert</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(total)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {order.receipts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Wareneingänge</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Beleg</TableHead>
                  <TableHead>Zeitpunkt</TableHead>
                  <TableHead>Lieferschein</TableHead>
                  <TableHead className="text-right">Stück</TableHead>
                  <TableHead>Gebucht von</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.receiptNumber}</TableCell>
                    <TableCell>{formatDateTime(r.receivedAt)}</TableCell>
                    <TableCell>{r.deliveryNoteNumber ?? "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell>{r.receivedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
