"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { columnHelper, DataTable } from "@/components/shared/data-table";
import { FieldHint, FormSheet } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveSupplierAction } from "@/modules/suppliers/actions";

type Row = {
  id: string;
  supplierNumber: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  active: boolean;
  articles: number;
  openOrders: number;
};

export function SuppliersClient({ rows }: { rows: Row[] }) {
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const h = columnHelper<Row>();
  const columns = [
    h.accessor("supplierNumber", { header: "Nr." }),
    h.accessor("name", { header: "Name", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
    h.accessor("contactPerson", { header: "Ansprechpartner", cell: (c) => c.getValue() ?? "–" }),
    h.accessor("email", { header: "E-Mail", cell: (c) => (c.getValue() ? <a href={`mailto:${c.getValue()}`} className="hover:underline">{c.getValue()}</a> : "–") }),
    h.accessor("phone", { header: "Telefon", cell: (c) => c.getValue() ?? "–" }),
    h.accessor("articles", { header: "Artikel", meta: { align: "right" } }),
    h.accessor("openOrders", { header: "Offene Bestellungen", meta: { align: "right" } }),
    h.accessor("active", { header: "Status", cell: (c) => (c.getValue() ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Inaktiv</StatusBadge>) }),
    h.display({
      id: "actions",
      header: () => <span className="sr-only">Aktionen</span>,
      cell: (c) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(c.row.original)}>
          Bearbeiten
        </Button>
      ),
    }),
  ];
  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        toolbar={
          <Button className="ml-auto" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Neuer Lieferant
          </Button>
        }
      />
      {editing && <SupplierSheet key={editing === "new" ? "new" : editing.id} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SupplierSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const [v, setV] = useState({
    supplierNumber: row?.supplierNumber ?? "",
    name: row?.name ?? "",
    contactPerson: row?.contactPerson ?? "",
    email: row?.email ?? "",
    phone: row?.phone ?? "",
    website: row?.website ?? "",
    notes: row?.notes ?? "",
    active: row?.active ?? true,
  });
  const text = (key: keyof typeof v, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`s-${key}`}>{label}</Label>
      <Input id={`s-${key}`} type={type} value={String(v[key] ?? "")} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
      <FieldHint error={fieldErrors[key]} />
    </div>
  );
  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? row.name : "Neuer Lieferant"}
      pending={pending}
      onSubmit={async () => {
        const res = await run(() => saveSupplierAction(row?.id ?? null, v), { success: "Lieferant gespeichert." });
        if (res.ok) onClose();
      }}
    >
      {text("supplierNumber", "Lieferantennummer")}
      {text("name", "Name")}
      {text("contactPerson", "Ansprechpartner")}
      {text("email", "E-Mail", "email")}
      {text("phone", "Telefon", "tel")}
      {text("website", "Website", "url")}
      <div className="space-y-1">
        <Label htmlFor="s-notes">Notizen</Label>
        <Textarea id="s-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} rows={3} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} /> Aktiv
      </label>
    </FormSheet>
  );
}
