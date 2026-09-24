"use client";

import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { columnHelper, DataTable } from "@/components/shared/data-table";
import { FieldHint, FormSheet } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/dates";
import { createUserAction, resetPasswordAction, updateUserAction } from "@/modules/users/actions";

type Role = "ADMIN" | "MANAGER" | "RESPONSIBLE";
type Row = { id: string; name: string; email: string; role: Role; active: boolean; restrictedToDepartments: boolean; departmentIds: string[]; departments: string[]; lastSeen: string | null };

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Administrator", MANAGER: "Manager", RESPONSIBLE: "Verantwortlicher" };
const ROLE_HINT: Record<Role, string> = {
  ADMIN: "Vollzugriff inkl. Benutzer, Einstellungen und Kontingentregeln.",
  MANAGER: "Operative Funktionen, Auswertungen, Sonderfreigaben, Lagerkorrekturen, Bestellungen.",
  RESPONSIBLE: "Mitarbeiter und Kontingente ansehen, Kleidung ausgeben, Bedarf anfordern, Wareneingang buchen.",
};

export function UsersClient({ rows, departments, currentUserId }: { rows: Row[]; departments: Array<{ id: string; name: string }>; currentUserId: string }) {
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const h = columnHelper<Row>();
  const columns = [
    h.accessor("name", { header: "Name", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
    h.accessor("email", { header: "E-Mail" }),
    h.accessor("role", { header: "Rolle", cell: (c) => ROLE_LABEL[c.getValue()] }),
    h.accessor((r) => (r.restrictedToDepartments ? r.departments.join(", ") : "alle"), { id: "scope", header: "Abteilungen" }),
    h.accessor("lastSeen", { header: "Zuletzt aktiv", cell: (c) => formatDateTime(c.getValue()), enableGlobalFilter: false }),
    h.accessor("active", { header: "Status", cell: (c) => (c.getValue() ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Deaktiviert</StatusBadge>) }),
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
            <Plus className="size-4" /> Neuer Benutzer
          </Button>
        }
      />
      {editing && <UserSheet key={editing === "new" ? "new" : editing.id} row={editing === "new" ? null : editing} departments={departments} isSelf={editing !== "new" && editing.id === currentUserId} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserSheet({ row, departments, isSelf, onClose }: { row: Row | null; departments: Array<{ id: string; name: string }>; isSelf: boolean; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const [v, setV] = useState({
    name: row?.name ?? "",
    email: row?.email ?? "",
    role: (row?.role ?? "RESPONSIBLE") as Role,
    active: row?.active ?? true,
    restrictedToDepartments: row?.restrictedToDepartments ?? false,
    departmentIds: row?.departmentIds ?? [],
  });
  const [password, setPassword] = useState("");
  const [resetPw, setResetPw] = useState("");

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? row.name : "Neuer Benutzer"}
      pending={pending}
      onSubmit={async () => {
        const res = row
          ? await run(() => updateUserAction(row.id, v), { success: "Benutzer gespeichert." })
          : await run(() => createUserAction({ ...v, password }), { success: "Benutzer angelegt." });
        if (res.ok) onClose();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="u-name">Name</Label>
        <Input id="u-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <FieldHint error={fieldErrors.name} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="u-email">E-Mail (Anmeldename)</Label>
        <Input id="u-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="off" />
        <FieldHint error={fieldErrors.email} />
      </div>
      {!row && (
        <div className="space-y-1">
          <Label htmlFor="u-pw">Initialpasswort</Label>
          <Input id="u-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">Mind. 12 Zeichen mit Groß-/Kleinbuchstaben und Ziffern. Bitte sicher übermitteln.</p>
          <FieldHint error={fieldErrors.password} />
        </div>
      )}
      <div className="space-y-1">
        <Label>Rolle</Label>
        <Select value={v.role} onValueChange={(role) => setV({ ...v, role: role as Role, restrictedToDepartments: role === "ADMIN" ? false : v.restrictedToDepartments })} disabled={isSelf}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{ROLE_HINT[v.role]}</p>
      </div>
      {v.role !== "ADMIN" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.restrictedToDepartments} onCheckedChange={(restrictedToDepartments) => setV({ ...v, restrictedToDepartments })} /> Nur bestimmte Abteilungen
          </label>
          {v.restrictedToDepartments && (
            <div className="grid grid-cols-2 gap-2 rounded-md border p-2">
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={v.departmentIds.includes(d.id)}
                    onCheckedChange={(c) => setV({ ...v, departmentIds: c ? [...v.departmentIds, d.id] : v.departmentIds.filter((x) => x !== d.id) })}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} disabled={isSelf} /> Aktiv (deaktivierte Benutzer werden sofort abgemeldet)
      </label>
      {row && (
        <div className="space-y-1 border-t pt-4">
          <Label htmlFor="u-reset">Neues Passwort setzen</Label>
          <div className="flex gap-2">
            <Input id="u-reset" type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoComplete="new-password" />
            <Button
              type="button"
              variant="outline"
              disabled={pending || resetPw.length < 12}
              onClick={async () => {
                const res = await run(() => resetPasswordAction(row.id, resetPw), { success: "Passwort gesetzt, bestehende Sitzungen beendet.", refresh: false });
                if (res.ok) setResetPw("");
              }}
            >
              <KeyRound className="size-4" /> Setzen
            </Button>
          </div>
        </div>
      )}
    </FormSheet>
  );
}
