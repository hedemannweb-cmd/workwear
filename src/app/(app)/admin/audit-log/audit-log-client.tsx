"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { columnHelper, DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDateTime } from "@/lib/dates";

type Row = { id: string; createdAt: string; user: string; action: string; entityType: string; entityId: string; oldValue: unknown; newValue: unknown; reason: string | null };

export function AuditLogClient({ rows, actions, users, filter }: { rows: Row[]; actions: string[]; users: Array<{ id: string; name: string }>; filter: { action: string; userId: string } }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Row | null>(null);
  const setFilter = (key: "aktion" | "benutzer", value: string) => {
    const p = new URLSearchParams();
    if (key === "aktion" ? value : filter.action) p.set("aktion", key === "aktion" ? value : filter.action);
    if (key === "benutzer" ? value : filter.userId) p.set("benutzer", key === "benutzer" ? value : filter.userId);
    router.push(`/admin/audit-log?${p.toString()}`);
  };
  const h = columnHelper<Row>();
  const columns = [
    h.accessor("createdAt", { header: "Zeitpunkt", cell: (c) => <span className="whitespace-nowrap">{formatDateTime(c.getValue())}</span>, enableGlobalFilter: false }),
    h.accessor("user", { header: "Benutzer" }),
    h.accessor("action", { header: "Aktion", cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
    h.accessor("entityType", { header: "Objekt" }),
    h.accessor("reason", { header: "Begründung", cell: (c) => c.getValue() ?? "–" }),
    h.display({
      id: "details",
      header: () => <span className="sr-only">Details</span>,
      cell: (c) => (
        <Button variant="ghost" size="sm" onClick={() => setSelected(c.row.original)}>
          Details
        </Button>
      ),
    }),
  ];
  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        dense
        pageSize={50}
        toolbar={
          <>
            <Select value={filter.action || "__all"} onValueChange={(v) => setFilter("aktion", v === "__all" ? "" : v)}>
              <SelectTrigger className="w-60" aria-label="Aktion filtern">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Alle Aktionen</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filter.userId || "__all"} onValueChange={(v) => setFilter("benutzer", v === "__all" ? "" : v)}>
              <SelectTrigger className="w-48" aria-label="Benutzer filtern">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Alle Benutzer</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{selected.action}</SheetTitle>
                <SheetDescription>
                  {formatDateTime(selected.createdAt)} · {selected.user} · {selected.entityType} {selected.entityId}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6 text-sm">
                {selected.reason && (
                  <div>
                    <div className="font-medium">Begründung</div>
                    <p>{selected.reason}</p>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="font-medium">Vorher</div>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{selected.oldValue ? JSON.stringify(selected.oldValue, null, 2) : "–"}</pre>
                  </div>
                  <div>
                    <div className="font-medium">Nachher</div>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{selected.newValue ? JSON.stringify(selected.newValue, null, 2) : "–"}</pre>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
