"use client";

import { CheckCheck, Loader2, PackageCheck, Send } from "lucide-react";
import { useState } from "react";
import { ReasonDialog } from "@/components/shared/reason-dialog";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelOrderAction, confirmOrderAction, markOrderedAction, receiveGoodsAction } from "@/modules/orders/actions";
import type { OrderDetail } from "@/modules/orders/server/queries";

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });

export function OrderActions({ order, perms }: { order: OrderDetail; perms: { manage: boolean; cancel: boolean; receive: boolean } }) {
  const { run, pending } = useAction();
  const [orderedOpen, setOrderedOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const receivable = ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(order.status);
  const nothingReceived = order.items.every((i) => i.quantityReceived === 0);

  return (
    <>
      {perms.manage && order.status === "DRAFT" && (
        <Button onClick={() => setOrderedOpen(true)}>
          <Send className="size-4" /> Als bestellt markieren
        </Button>
      )}
      {perms.manage && order.status === "ORDERED" && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => confirmOrderAction({ orderId: order.id }), { success: "Auftragsbestätigung erfasst." })}>
          <CheckCheck className="size-4" /> Bestätigt
        </Button>
      )}
      {perms.receive && receivable && (
        <Button onClick={() => setReceiveOpen(true)}>
          <PackageCheck className="size-4" /> Wareneingang buchen
        </Button>
      )}
      {perms.cancel && ["DRAFT", "ORDERED", "CONFIRMED"].includes(order.status) && nothingReceived && (
        <ReasonDialog
          trigger={<Button variant="outline">Stornieren</Button>}
          title={`Bestellung ${order.orderNumber} stornieren`}
          description="Enthaltene Mitarbeiteranforderungen gehen zurück in den offenen Bedarf."
          confirmLabel="Bestellung stornieren"
          destructive
          pending={pending}
          onConfirm={(reason) => run(() => cancelOrderAction({ orderId: order.id, reason }), { success: "Bestellung storniert." })}
        />
      )}
      {orderedOpen && <MarkOrderedDialog orderId={order.id} onClose={() => setOrderedOpen(false)} />}
      {receiveOpen && <ReceiveDialog order={order} onClose={() => setReceiveOpen(false)} />}
    </>
  );
}

function MarkOrderedDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { run, pending } = useAction();
  const [orderDate, setOrderDate] = useState(todayIso());
  const [expected, setExpected] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Beim Lieferanten bestellt</DialogTitle>
          <DialogDescription>Die Bestellung wird nicht aus dem System versendet. Nutzen Sie den CSV-Export für Ihre E-Mail an den Lieferanten.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="o-date">Bestelldatum</Label>
            <Input id="o-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="o-exp">Liefertermin (optional)</Label>
            <Input id="o-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            <p className="text-xs text-muted-foreground">Leer = Bestelldatum + Lieferzeit des Lieferanten.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || !orderDate}
            onClick={async () => {
              const res = await run(() => markOrderedAction({ orderId, orderDate, expectedDeliveryDate: expected || undefined }), { success: "Bestellung als bestellt markiert." });
              if (res.ok) onClose();
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Wareneingang: gelieferte Menge je Position. Die Zuteilung an Mitarbeiter erfolgt serverseitig FIFO
 * (älteste Anforderung zuerst); die Vorschau hier zeigt dieselbe Reihenfolge. Pro Mitarbeiter wählbar:
 * direkt ausgeben oder reserviert einlagern.
 */
function ReceiveDialog({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const { run, pending } = useAction();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.items.map((i) => [i.id, String(Math.max(0, i.quantityOrdered - i.quantityReceived))])),
  );
  const [direct, setDirect] = useState<string[]>([]);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [over, setOver] = useState(false);

  const allocation = (item: OrderDetail["items"][number]) => {
    let remaining = Number(qty[item.id]) || 0;
    const served: Array<{ id: string; name: string; quantity: number; partial: boolean }> = [];
    for (const r of item.reservations.filter((x) => x.status === "ORDERED")) {
      if (remaining <= 0) break;
      const take = Math.min(r.quantity, remaining);
      served.push({ id: r.id, name: r.employee.name, quantity: take, partial: take < r.quantity });
      remaining -= take;
    }
    return { served, toStock: remaining };
  };
  const overDelivery = order.items.some((i) => (Number(qty[i.id]) || 0) > i.quantityOrdered - i.quantityReceived);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Wareneingang zu {order.orderNumber}</DialogTitle>
          <DialogDescription>Teillieferungen sind möglich – offene Mengen bleiben bestellt.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="r-ls">Lieferscheinnummer</Label>
          <Input id="r-ls" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} className="max-w-xs" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artikel</TableHead>
              <TableHead className="text-right">Offen</TableHead>
              <TableHead className="w-24 text-right">Geliefert</TableHead>
              <TableHead>Zuteilung</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((i) => {
              const open = Math.max(0, i.quantityOrdered - i.quantityReceived);
              const a = allocation(i);
              return (
                <TableRow key={i.id} className="align-top">
                  <TableCell>{i.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{open}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      className="h-8 text-right"
                      aria-label={`Gelieferte Menge ${i.label}`}
                      value={qty[i.id] ?? ""}
                      onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <ul className="space-y-1 text-sm">
                      {a.served.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-2">
                          <span className="tabular-nums">{s.quantity} ×</span>
                          <span>{s.name}</span>
                          {s.partial && <span className="text-xs text-muted-foreground">(Teilmenge)</span>}
                          <label className="ml-auto flex items-center gap-1 text-xs">
                            <Checkbox checked={direct.includes(s.id)} onCheckedChange={(c) => setDirect((d) => (c ? [...d, s.id] : d.filter((x) => x !== s.id)))} />
                            direkt ausgeben
                          </label>
                        </li>
                      ))}
                      {a.toStock > 0 && <li className="text-muted-foreground">{a.toStock} × ins freie Lager</li>}
                    </ul>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {overDelivery && (
          <label className="flex items-center gap-2 rounded-md bg-warning p-2 text-sm text-warning-foreground">
            <Checkbox checked={over} onCheckedChange={(c) => setOver(c === true)} /> Überlieferung bestätigen (mehr geliefert als offen)
          </label>
        )}
        <p className="text-xs text-muted-foreground">
          Nicht direkt ausgegebene Mitarbeiterware wird reserviert eingelagert und erscheint unter „Eingetroffen“ sowie auf der Mitarbeiterseite.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || (overDelivery && !over) || order.items.every((i) => !(Number(qty[i.id]) > 0))}
            onClick={async () => {
              const res = await run(
                () =>
                  receiveGoodsAction({
                    orderId: order.id,
                    clientRequestId: crypto.randomUUID(),
                    deliveryNoteNumber: deliveryNote || undefined,
                    items: order.items.map((i) => ({ orderItemId: i.id, quantity: Math.max(0, Number(qty[i.id]) || 0) })),
                    directIssueReservationIds: direct.filter((id) => order.items.some((i) => allocation(i).served.some((s) => s.id === id))),
                    allowOverDelivery: over,
                  }),
                {
                  success: (d) =>
                    `Wareneingang ${d.receiptNumber}: ${d.reservedForEmployees} für Mitarbeiter reserviert, ${d.issuedDirectly} direkt ausgegeben, ${d.toFreeStock} ins Lager.`,
                },
              );
              if (res.ok) onClose();
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Wareneingang buchen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
