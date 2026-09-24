"use client";

import { Loader2, PackagePlus, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { columnHelper, DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ORDER_STATUS, StatusBadge, StatusOf } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { createPurchaseOrderAction, stockOrderCandidatesAction } from "@/modules/orders/actions";

// ───────────────────────────── Bedarf ─────────────────────────────

type DemandRow = {
  id: string;
  createdAt: string;
  quantity: number;
  quotaYear: number;
  employee: { id: string; name: string; number: string; department: string };
  variantId: string;
  variant: string;
  sku: string;
  supplierId: string | null;
  supplier: string | null;
  unitPrice: number | null;
  freeNow: number;
  createdBy: string;
};

export function DemandPanel({ rows, canManage }: { rows: DemandRow[]; canManage: boolean }) {
  const groups = useMemo(() => {
    const map = new Map<string, { supplierId: string | null; supplier: string; rows: DemandRow[] }>();
    for (const r of rows) {
      const key = r.supplierId ?? "none";
      const g = map.get(key) ?? { supplierId: r.supplierId, supplier: r.supplier ?? "Ohne Vorzugslieferant", rows: [] };
      g.rows.push(r);
      map.set(key, g);
    }
    return [...map.values()];
  }, [rows]);

  if (rows.length === 0) {
    return <EmptyState title="Kein offener Bedarf" description="Alle Mitarbeiteranforderungen sind bestellt oder erledigt." icon={ShoppingCart} />;
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <DemandGroup key={g.supplierId ?? "none"} group={g} canManage={canManage} />
      ))}
    </div>
  );
}

function DemandGroup({ group, canManage }: { group: { supplierId: string | null; supplier: string; rows: DemandRow[] }; canManage: boolean }) {
  const [selected, setSelected] = useState<string[]>(group.rows.filter((r) => r.freeNow < r.quantity).map((r) => r.id));
  const [dialog, setDialog] = useState(false);
  const chosen = group.rows.filter((r) => selected.includes(r.id));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{group.supplier}</CardTitle>
        {canManage && group.supplierId && (
          <CardAction>
            <Button size="sm" disabled={chosen.length === 0} onClick={() => setDialog(true)}>
              <ShoppingCart className="size-4" /> Bestellung erstellen ({chosen.length})
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {!group.supplierId && <p className="mb-2 text-sm text-warning-foreground">Diesen Artikeln ist kein Vorzugslieferant zugeordnet. Bitte am Artikel hinterlegen.</p>}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {canManage && group.supplierId && (
                  <TableHead className="w-8">
                    <Checkbox
                      aria-label="Alle auswählen"
                      checked={selected.length === group.rows.length}
                      onCheckedChange={(c) => setSelected(c ? group.rows.map((r) => r.id) : [])}
                    />
                  </TableHead>
                )}
                <TableHead>Angefordert</TableHead>
                <TableHead>Mitarbeiter</TableHead>
                <TableHead>Artikel</TableHead>
                <TableHead className="text-right">Menge</TableHead>
                <TableHead>Lager jetzt</TableHead>
                <TableHead>von</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((r) => (
                <TableRow key={r.id}>
                  {canManage && group.supplierId && (
                    <TableCell>
                      <Checkbox
                        aria-label={`${r.variant} für ${r.employee.name} auswählen`}
                        checked={selected.includes(r.id)}
                        onCheckedChange={(c) => setSelected((s) => (c ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                      />
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
                  <TableCell>
                    <Link href={`/employees/${r.employee.id}`} className="font-medium hover:underline">
                      {r.employee.name}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      {r.employee.number} · {r.employee.department}
                    </span>
                  </TableCell>
                  <TableCell>{r.variant}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell>
                    {r.freeNow >= r.quantity ? (
                      <StatusBadge tone="success">{r.freeNow} verfügbar – direkt ausgeben</StatusBadge>
                    ) : (
                      <span className="text-muted-foreground tabular-nums">{r.freeNow}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.createdBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      {dialog && group.supplierId && <CreateOrderDialog supplierId={group.supplierId} supplier={group.supplier} rows={chosen} onClose={() => setDialog(false)} />}
    </Card>
  );
}

function CreateOrderDialog({ supplierId, supplier, rows, onClose }: { supplierId: string; supplier: string; rows: DemandRow[]; onClose: () => void }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const lines = useMemo(() => {
    const map = new Map<string, { variantId: string; label: string; qty: number; unitPrice: number | null }>();
    for (const r of rows) {
      const l = map.get(r.variantId) ?? { variantId: r.variantId, label: r.variant, qty: 0, unitPrice: r.unitPrice };
      l.qty += r.quantity;
      map.set(r.variantId, l);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "de"));
  }, [rows]);
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const total = lines.reduce((s, l) => s + (l.qty + (Number(extra[l.variantId]) || 0)) * (l.unitPrice ?? 0), 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sammelbestellung bei {supplier}</DialogTitle>
          <DialogDescription>
            {rows.length} Mitarbeiteranforderungen, zusammengefasst je Variante. Optional zusätzliche Lagermenge mitbestellen. Die Bestellung wird als Entwurf angelegt.
          </DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artikel</TableHead>
              <TableHead className="text-right">Mitarbeiter</TableHead>
              <TableHead className="w-28 text-right">+ Lager</TableHead>
              <TableHead className="text-right">Gesamt</TableHead>
              <TableHead className="text-right">EK</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.variantId}>
                <TableCell>{l.label}</TableCell>
                <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    aria-label={`Zusätzliche Lagermenge ${l.label}`}
                    className="h-8 text-right"
                    value={extra[l.variantId] ?? ""}
                    onChange={(e) => setExtra({ ...extra, [l.variantId]: e.target.value })}
                  />
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{l.qty + (Number(extra[l.variantId]) || 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(l.unitPrice)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="text-right text-sm">
          Bestellwert: <span className="font-semibold">{formatCurrency(total)}</span>
        </div>
        <Textarea placeholder="Notiz zur Bestellung (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              const res = await run(
                () =>
                  createPurchaseOrderAction({
                    supplierId,
                    reservationIds: rows.map((r) => r.id),
                    stockItems: lines.filter((l) => Number(extra[l.variantId]) > 0).map((l) => ({ articleVariantId: l.variantId, quantity: Number(extra[l.variantId]) })),
                    notes: notes || undefined,
                  }),
                { success: (d) => `Bestellentwurf ${d.orderNumber} angelegt.`, onSuccess: (d) => router.push(`/orders/${d.orderId}`) },
              );
              if (res.ok) onClose();
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Bestellentwurf anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Lagerbestellung mit Bestellvorschlag ─────────────────────────────

type Candidate = { variantId: string; label: string; free: number; openOrdered: number; minStock: number | null; unitPrice: number | null; suggested: number };

export function StockOrderButton({ suppliers }: { suppliers: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const { run, pending } = useAction();

  async function loadCandidates(id: string) {
    setSupplierId(id);
    setCandidates(null);
    const res = await run(() => stockOrderCandidatesAction(id), { refresh: false });
    if (res.ok) {
      setCandidates(res.data);
      setQty(Object.fromEntries(res.data.filter((c) => c.suggested > 0).map((c) => [c.variantId, String(c.suggested)])));
    }
  }

  const items = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([articleVariantId, v]) => ({ articleVariantId, quantity: Number(v) }));

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PackagePlus className="size-4" /> Lagerbestellung
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Lagerbestellung</DialogTitle>
            <DialogDescription>
              Mengen sind mit einem Vorschlag vorbelegt (Auffüllen auf Mindestbestand abzüglich bereits bestellter Mengen). Nichts wird automatisch versendet – es entsteht ein Entwurf.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Lieferant</Label>
            <Select value={supplierId} onValueChange={loadCandidates}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Bitte wählen" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {supplierId && !candidates && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
          {candidates && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artikel</TableHead>
                  <TableHead className="text-right">Frei</TableHead>
                  <TableHead className="text-right">Bestellt</TableHead>
                  <TableHead className="text-right">Mindest</TableHead>
                  <TableHead className="w-24 text-right">Menge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow key={c.variantId} className={c.suggested > 0 ? "bg-warning/40" : undefined}>
                    <TableCell>{c.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.free}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.openOrdered || "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.minStock ?? "–"}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 text-right"
                        aria-label={`Menge ${c.label}`}
                        value={qty[c.variantId] ?? ""}
                        onChange={(e) => setQty({ ...qty, [c.variantId]: e.target.value })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={pending || items.length === 0}
              onClick={async () => {
                const res = await run(() => createPurchaseOrderAction({ supplierId, stockItems: items }), {
                  success: (d) => `Bestellentwurf ${d.orderNumber} angelegt.`,
                  onSuccess: (d) => router.push(`/orders/${d.orderId}`),
                });
                if (res.ok) setOpen(false);
              }}
            >
              Entwurf anlegen ({items.length} Positionen)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────────── Eingetroffen / Bestellungen ─────────────────────────────

type ArrivedRow = { id: string; receivedAt: string | null; quantity: number; employee: { id: string; name: string; number: string; department: string }; variant: string; location: string };

export function ArrivedTable({ rows }: { rows: ArrivedRow[] }) {
  if (rows.length === 0) return <EmptyState title="Nichts wartet auf Ausgabe" description="Eingetroffene Mitarbeiterartikel erscheinen hier, bis sie ausgegeben sind." />;
  const h = columnHelper<ArrivedRow>();
  const columns = [
    h.accessor("receivedAt", { header: "Eingetroffen", cell: (c) => formatDate(c.getValue()), enableGlobalFilter: false }),
    h.accessor((r) => r.employee.name, { id: "employee", header: "Mitarbeiter", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
    h.accessor((r) => r.employee.number, { id: "number", header: "Personalnr." }),
    h.accessor((r) => r.employee.department, { id: "department", header: "Abteilung" }),
    h.accessor("variant", { header: "Artikel" }),
    h.accessor("quantity", { header: "Menge", meta: { align: "right" }, enableGlobalFilter: false }),
    h.accessor("location", { header: "Liegt bereit in" }),
    h.display({ id: "go", header: () => <span className="sr-only">Aktion</span>, cell: () => <span className="text-sm text-primary">Ausgeben →</span> }),
  ];
  return <DataTable data={rows} columns={columns} rowHref={(r) => `/employees/${r.employee.id}`} />;
}

type OrderRow = {
  id: string;
  orderNumber: string;
  supplier: string;
  status: string;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  overdue: boolean;
  ordered: number;
  received: number;
  total: number;
  createdBy: string;
};

export function OrdersTable({ rows }: { rows: OrderRow[] }) {
  if (rows.length === 0) return <EmptyState title="Keine Bestellungen" />;
  const h = columnHelper<OrderRow>();
  const columns = [
    h.accessor("orderNumber", { header: "Bestellnr.", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
    h.accessor("supplier", { header: "Lieferant" }),
    h.accessor("status", {
      header: "Status",
      cell: (c) => (
        <span className="flex gap-1">
          <StatusOf map={ORDER_STATUS} status={c.getValue()} />
          {c.row.original.overdue && <StatusBadge tone="danger">überfällig</StatusBadge>}
        </span>
      ),
    }),
    h.accessor("orderDate", { header: "Bestellt am", cell: (c) => formatDate(c.getValue()), enableGlobalFilter: false }),
    h.accessor("expectedDeliveryDate", { header: "Liefertermin", cell: (c) => formatDate(c.getValue()), enableGlobalFilter: false }),
    h.accessor("ordered", { header: "Menge", meta: { align: "right" }, enableGlobalFilter: false, cell: (c) => `${c.row.original.received} / ${c.getValue()}` }),
    h.accessor("total", { header: "Wert", meta: { align: "right" }, enableGlobalFilter: false, cell: (c) => formatCurrency(c.getValue()) }),
    h.accessor("createdBy", { header: "Angelegt von" }),
  ];
  return <DataTable data={rows} columns={columns} rowHref={(r) => `/orders/${r.id}`} searchPlaceholder="Bestellnummer, Lieferant …" />;
}
