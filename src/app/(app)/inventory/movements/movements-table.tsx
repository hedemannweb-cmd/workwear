"use client";

import Link from "next/link";
import { columnHelper, DataTable } from "@/components/shared/data-table";
import { formatDateTime } from "@/lib/dates";
import { formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  createdAt: string;
  typeLabel: string;
  article: string;
  location: string;
  quantityDelta: number;
  reservedDelta: number;
  physicalAfter: number;
  reservedAfter: number;
  user: string;
  reason: string | null;
  reference: { label: string; href?: string } | null;
};

const h = columnHelper<Row>();
const columns = [
  h.accessor("createdAt", { header: "Zeitpunkt", cell: (c) => <span className="whitespace-nowrap">{formatDateTime(c.getValue())}</span>, enableGlobalFilter: false }),
  h.accessor("typeLabel", { header: "Art" }),
  h.accessor("article", { header: "Artikel" }),
  h.accessor("location", { header: "Lagerort" }),
  h.accessor("quantityDelta", {
    header: "Menge",
    meta: { align: "right" },
    enableGlobalFilter: false,
    cell: (c) => (c.getValue() === 0 ? "–" : <span className={cn("font-medium", c.getValue() < 0 ? "text-danger-foreground" : "text-success-foreground")}>{formatSigned(c.getValue())}</span>),
  }),
  h.accessor("reservedDelta", { header: "Reserviert ±", meta: { align: "right" }, enableGlobalFilter: false, cell: (c) => (c.getValue() === 0 ? "–" : formatSigned(c.getValue())) }),
  h.accessor("physicalAfter", { header: "Bestand danach", meta: { align: "right" }, enableGlobalFilter: false, cell: (c) => `${c.getValue()} (${c.row.original.reservedAfter} res.)` }),
  h.accessor("user", { header: "Benutzer" }),
  h.accessor((r) => r.reference?.label ?? "", {
    id: "reference",
    header: "Beleg",
    cell: (c) => {
      const ref = c.row.original.reference;
      if (!ref) return "–";
      return ref.href ? (
        <Link href={ref.href} className="hover:underline">
          {ref.label}
        </Link>
      ) : (
        ref.label
      );
    },
  }),
  h.accessor("reason", { header: "Begründung", cell: (c) => <span className="text-muted-foreground">{c.getValue() ?? ""}</span> }),
];

export function MovementsTable({ rows }: { rows: Row[] }) {
  return <DataTable data={rows} columns={columns} dense pageSize={50} searchPlaceholder="Artikel, Benutzer, Beleg …" />;
}
