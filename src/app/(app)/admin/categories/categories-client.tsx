"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { columnHelper, DataTable } from "@/components/shared/data-table";
import { FieldHint, FormSheet } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { deleteCategoryAction, saveCategoryAction } from "@/modules/categories/actions";

type Row = {
  id: string;
  name: string;
  sizeScaleId: string | null;
  sizeScale: string | null;
  sortOrder: number;
  active: boolean;
  articles: number;
  employeeSizes: number;
};

type SizeScale = { id: string; name: string };

const NO_SCALE = "__none";

export function CategoriesClient({ rows, sizeScales }: { rows: Row[]; sizeScales: SizeScale[] }) {
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const { run, pending } = useAction();
  const h = columnHelper<Row>();
  const columns = [
    h.accessor("sortOrder", { header: "Reihenfolge", meta: { align: "right" } }),
    h.accessor("name", { header: "Name", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
    h.accessor("sizeScale", { header: "Größenskala", cell: (c) => c.getValue() ?? "ohne Größen" }),
    h.accessor("articles", { header: "Artikel", meta: { align: "right" } }),
    h.accessor("active", { header: "Status", cell: (c) => (c.getValue() ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Inaktiv</StatusBadge>) }),
    h.display({
      id: "actions",
      header: () => <span className="sr-only">Aktionen</span>,
      cell: (c) => {
        const row = c.row.original;
        const inUse = row.articles + row.employeeSizes > 0;
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
              Bearbeiten
            </Button>
            {inUse ? (
              <Button variant="ghost" size="sm" disabled title={row.articles > 0 ? "Enthält noch Artikel, nur Deaktivieren möglich" : "Mitarbeitergrößen hinterlegt, nur Deaktivieren möglich"}>
                Löschen
              </Button>
            ) : (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm" className="text-destructive">
                    Löschen
                  </Button>
                }
                title={`Kategorie „${row.name}“ löschen`}
                description="Die Kategorie enthält keine Artikel und wird endgültig entfernt."
                confirmLabel="Kategorie löschen"
                destructive
                pending={pending}
                onConfirm={() => run(() => deleteCategoryAction(row.id), { success: "Kategorie gelöscht." })}
              />
            )}
          </div>
        );
      },
    }),
  ];
  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        toolbar={
          <Button className="ml-auto" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Neue Kategorie
          </Button>
        }
      />
      {editing && (
        <CategorySheet
          key={editing === "new" ? "new" : editing.id}
          row={editing === "new" ? null : editing}
          sizeScales={sizeScales}
          nextSortOrder={Math.max(0, ...rows.map((r) => r.sortOrder)) + 1}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CategorySheet({ row, sizeScales, nextSortOrder, onClose }: { row: Row | null; sizeScales: SizeScale[]; nextSortOrder: number; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const [v, setV] = useState({
    name: row?.name ?? "",
    sizeScaleId: row?.sizeScaleId ?? null,
    sortOrder: String(row?.sortOrder ?? nextSortOrder),
    active: row?.active ?? true,
  });
  const scaleLocked = !!row && row.articles + row.employeeSizes > 0;
  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? row.name : "Neue Kategorie"}
      pending={pending}
      onSubmit={async () => {
        const res = await run(() => saveCategoryAction(row?.id ?? null, v), { success: "Kategorie gespeichert." });
        if (res.ok) onClose();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="c-name">Name</Label>
        <Input id="c-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <FieldHint error={fieldErrors.name} />
      </div>
      <div className="space-y-1">
        <Label>Größenskala</Label>
        <Select value={v.sizeScaleId ?? NO_SCALE} onValueChange={(s) => setV({ ...v, sizeScaleId: s === NO_SCALE ? null : s })} disabled={scaleLocked}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SCALE}>ohne Größen</SelectItem>
            {sizeScales.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scaleLocked && <p className="text-sm text-muted-foreground">Nicht mehr änderbar, weil bereits Artikel oder Mitarbeitergrößen an der Kategorie hängen.</p>}
        <FieldHint error={fieldErrors.sizeScaleId} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="c-sort">Reihenfolge</Label>
        <Input id="c-sort" type="number" min={0} value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
        <FieldHint error={fieldErrors.sortOrder} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} /> Aktiv (für neue Artikel auswählbar)
      </label>
    </FormSheet>
  );
}
