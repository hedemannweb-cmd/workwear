"use client";

import { ArrowLeftRight, ClipboardCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { columnHelper, DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { adjustInventoryAction, transferInventoryAction } from "@/modules/inventory/actions";

type Row = {
  key: string;
  articleId: string;
  articleName: string;
  sku: string;
  size: string | null;
  color: string | null;
  variantId: string;
  locationId: string;
  location: string;
  locationType: string;
  physical: number;
  reserved: number;
  free: number;
  minStock: number | null;
};

export function InventoryTable({
  rows,
  locations,
  canAdjust,
  initialFilter,
}: {
  rows: Row[];
  locations: Array<{ id: string; name: string }>;
  canAdjust: boolean;
  initialFilter: "all" | "below" | "empty";
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [adjust, setAdjust] = useState<{ row: Row; mode: "count" | "delta" | "transfer" } | null>(null);
  const data = useMemo(
    () =>
      filter === "below"
        ? rows.filter((r) => r.minStock !== null && r.free < r.minStock)
        : filter === "empty"
          ? rows.filter((r) => r.locationType === "STORAGE" && r.free <= 0)
          : rows,
    [rows, filter],
  );

  const h = columnHelper<Row>();
  const columns = [
    h.accessor("articleName", {
      header: "Artikel",
      cell: (c) => (
        <Link href={`/articles/${c.row.original.articleId}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {c.getValue()}
        </Link>
      ),
    }),
    h.accessor("color", { header: "Farbe", cell: (c) => c.getValue() ?? "–" }),
    h.accessor("size", { header: "Größe", cell: (c) => <span className="font-medium">{c.getValue() ?? "–"}</span> }),
    h.accessor("sku", { header: "SKU", cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
    h.accessor("location", { header: "Lagerort" }),
    h.accessor("physical", { header: "Physisch", meta: { align: "right" }, enableGlobalFilter: false }),
    h.accessor("reserved", { header: "Reserviert", meta: { align: "right" }, enableGlobalFilter: false }),
    h.accessor("free", { header: "Frei", meta: { align: "right" }, enableGlobalFilter: false }),
    h.accessor("minStock", { header: "Mindest", meta: { align: "right" }, enableGlobalFilter: false, cell: (c) => c.getValue() ?? "–" }),
    h.display({
      id: "status",
      header: "Status",
      cell: (c) => {
        const r = c.row.original;
        if (r.locationType === "DEFECTIVE") return <StatusBadge tone="neutral">Ausschuss</StatusBadge>;
        if (r.free <= 0) return <StatusBadge tone="danger">nicht verfügbar</StatusBadge>;
        if (r.minStock !== null && r.free < r.minStock) return <StatusBadge tone="warning">unter Mindestbestand</StatusBadge>;
        return <StatusBadge tone="success">verfügbar</StatusBadge>;
      },
    }),
    ...(canAdjust
      ? [
          h.display({
            id: "actions",
            header: () => <span className="sr-only">Aktionen</span>,
            cell: (c) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setAdjust({ row: c.row.original, mode: "count" })} title="Zählung / Korrektur">
                  <ClipboardCheck className="size-4" />
                  <span className="sr-only">Zählung / Korrektur</span>
                </Button>
                {locations.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setAdjust({ row: c.row.original, mode: "transfer" })} title="Umlagern">
                    <ArrowLeftRight className="size-4" />
                    <span className="sr-only">Umlagern</span>
                  </Button>
                )}
              </div>
            ),
          }),
        ]
      : []),
  ];

  return (
    <>
      <DataTable
        data={data}
        columns={columns}
        dense
        pageSize={50}
        searchPlaceholder="Artikel, Größe, SKU …"
        toolbar={
          <div className="flex gap-1" role="group" aria-label="Filter">
            {(
              [
                ["all", "Alle"],
                ["below", "Unter Mindestbestand"],
                ["empty", "Nicht verfügbar"],
              ] as const
            ).map(([k, label]) => (
              <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)} aria-pressed={filter === k}>
                {label}
              </Button>
            ))}
          </div>
        }
      />
      {adjust && <AdjustDialog target={adjust} locations={locations} onClose={() => setAdjust(null)} />}
    </>
  );
}

function AdjustDialog({
  target,
  locations,
  onClose,
}: {
  target: { row: Row; mode: "count" | "delta" | "transfer" };
  locations: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const { run, pending } = useAction();
  const [mode, setMode] = useState(target.mode);
  const [value, setValue] = useState(mode === "count" ? String(target.row.physical) : "");
  const [toLocation, setToLocation] = useState("");
  const [reason, setReason] = useState("");
  const r = target.row;
  const label = [r.articleName, r.color, r.size].filter(Boolean).join(" · ");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "transfer" ? "Umlagern" : "Bestand korrigieren"}</DialogTitle>
          <DialogDescription>
            {label} · {r.location} · physisch {r.physical}, reserviert {r.reserved}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {mode !== "transfer" && (
            <div className="flex gap-1" role="group">
              <Button size="sm" variant={mode === "count" ? "default" : "outline"} onClick={() => { setMode("count"); setValue(String(r.physical)); }}>
                Zählung (Ist-Bestand)
              </Button>
              <Button size="sm" variant={mode === "delta" ? "default" : "outline"} onClick={() => { setMode("delta"); setValue(""); }}>
                Korrektur (±)
              </Button>
            </div>
          )}
          {mode === "transfer" && (
            <div className="space-y-1">
              <Label>Ziel-Lagerort</Label>
              <Select value={toLocation} onValueChange={setToLocation}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Bitte wählen" />
                </SelectTrigger>
                <SelectContent>
                  {locations.filter((l) => l.id !== r.locationId).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="adj-value">{mode === "count" ? "Gezählter Bestand" : mode === "delta" ? "Änderung (z. B. -2 oder 5)" : "Menge"}</Label>
            <Input id="adj-value" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
            {mode === "count" && value !== "" && Number(value) !== r.physical && (
              <p className="text-sm text-muted-foreground">Differenz: {Number(value) - r.physical > 0 ? "+" : ""}{Number(value) - r.physical}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="adj-reason">Begründung (Pflicht)</Label>
            <Textarea id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || value === "" || reason.trim().length < 5 || (mode === "transfer" && !toLocation)}
            onClick={async () => {
              const res =
                mode === "transfer"
                  ? await run(() => transferInventoryAction({ articleVariantId: r.variantId, fromLocationId: r.locationId, toLocationId: toLocation, quantity: Number(value), reason }), { success: "Umgelagert." })
                  : mode === "count"
                    ? await run(() => adjustInventoryAction({ mode: "count", articleVariantId: r.variantId, inventoryLocationId: r.locationId, countedQuantity: Number(value), reason }), { success: "Zählung gebucht." })
                    : await run(() => adjustInventoryAction({ mode: "delta", articleVariantId: r.variantId, inventoryLocationId: r.locationId, quantityDelta: Number(value), reason }), { success: "Korrektur gebucht." });
              if (res.ok) onClose();
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Buchen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
