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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveDepartmentAction } from "@/modules/departments/actions";

type Row = { id: string; code: string; name: string; quotaProfileId: string | null; profile: string | null; costCenter: string | null; active: boolean; employees: number };

export function DepartmentsClient({ rows, profiles }: { rows: Row[]; profiles: Array<{ id: string; code: string; name: string }> }) {
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const h = columnHelper<Row>();
  const columns = [
    h.accessor("code", { header: "Code" }),
    h.accessor("name", { header: "Name", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
    h.accessor("profile", { header: "Kontingentprofil", cell: (c) => c.getValue() ?? <StatusBadge tone="warning">kein Profil</StatusBadge> }),
    h.accessor("costCenter", { header: "Kostenstelle", cell: (c) => c.getValue() ?? "–" }),
    h.accessor("employees", { header: "Aktive Mitarbeiter", meta: { align: "right" } }),
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
            <Plus className="size-4" /> Neue Abteilung
          </Button>
        }
      />
      {editing && <DepartmentSheet key={editing === "new" ? "new" : editing.id} row={editing === "new" ? null : editing} profiles={profiles} onClose={() => setEditing(null)} />}
    </>
  );
}

function DepartmentSheet({ row, profiles, onClose }: { row: Row | null; profiles: Array<{ id: string; code: string; name: string }>; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const [v, setV] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    quotaProfileId: row?.quotaProfileId ?? null,
    costCenter: row?.costCenter ?? null,
    active: row?.active ?? true,
  });
  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? `Abteilung ${row.name}` : "Neue Abteilung"}
      pending={pending}
      onSubmit={async () => {
        const res = await run(() => saveDepartmentAction(row?.id ?? null, v), { success: "Abteilung gespeichert." });
        if (res.ok) onClose();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="d-code">Code</Label>
        <Input id="d-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        <FieldHint error={fieldErrors.code} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="d-name">Name</Label>
        <Input id="d-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <FieldHint error={fieldErrors.name} />
      </div>
      <div className="space-y-1">
        <Label>Kontingentprofil</Label>
        <Select value={v.quotaProfileId ?? "__none"} onValueChange={(x) => setV({ ...v, quotaProfileId: x === "__none" ? null : x })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">kein Profil</SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} ({p.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Gilt für das Kontingent aller Mitarbeiter, die am Stichtag dieser Abteilung angehören.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="d-cc">Kostenstelle</Label>
        <Input id="d-cc" value={v.costCenter ?? ""} onChange={(e) => setV({ ...v, costCenter: e.target.value || null })} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} /> Aktiv
      </label>
    </FormSheet>
  );
}
