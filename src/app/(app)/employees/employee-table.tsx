"use client";

import { useMemo, useState } from "react";
import { columnHelper, DataTable } from "@/components/shared/data-table";
import { EMPLOYEE_STATUS, StatusBadge, StatusOf } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";

type Row = {
  id: string;
  employeeNumber: string;
  name: string;
  department: string;
  status: string;
  entryDate: string;
  hasSizes: boolean;
  openReservations: number;
};

const h = columnHelper<Row>();
const columns = [
  h.accessor("employeeNumber", { header: "Personalnr.", sortFn: "alphanumeric" }),
  h.accessor("name", { header: "Name", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  h.accessor("department", { header: "Abteilung" }),
  h.accessor("status", { header: "Status", cell: (c) => <StatusOf map={EMPLOYEE_STATUS} status={c.getValue()} />, enableGlobalFilter: false }),
  h.accessor("entryDate", { header: "Eintritt", cell: (c) => formatDate(c.getValue()), enableGlobalFilter: false }),
  h.accessor("openReservations", {
    header: "Offene Bestellungen",
    meta: { align: "right" },
    cell: (c) => (c.getValue() > 0 ? <StatusBadge tone="info" icon={null}>{c.getValue()}</StatusBadge> : <span className="text-muted-foreground">–</span>),
    enableGlobalFilter: false,
  }),
  h.accessor("hasSizes", {
    header: "Größen",
    cell: (c) => (c.getValue() ? <span className="text-muted-foreground">erfasst</span> : <StatusBadge tone="warning">fehlen</StatusBadge>),
    enableGlobalFilter: false,
  }),
];

export function EmployeeTable({ rows }: { rows: Row[] }) {
  const [showAll, setShowAll] = useState(false);
  const data = useMemo(() => (showAll ? rows : rows.filter((r) => r.status === "ACTIVE")), [rows, showAll]);
  return (
    <DataTable
      data={data}
      columns={columns}
      searchPlaceholder="Name, Personalnummer oder Abteilung …"
      rowHref={(r) => `/employees/${r.id}`}
      toolbar={
        <Button variant="outline" size="sm" onClick={() => setShowAll((s) => !s)} aria-pressed={showAll}>
          {showAll ? "Nur aktive anzeigen" : "Auch inaktive/ausgeschiedene anzeigen"}
        </Button>
      }
    />
  );
}
