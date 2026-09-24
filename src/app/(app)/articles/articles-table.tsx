"use client";

import { columnHelper, DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/format";

type Row = {
  id: string;
  sku: string;
  name: string;
  category: string;
  quotaGroup: string;
  supplier: string | null;
  price: string | null;
  variants: number;
  free: number;
  reserved: number;
  belowMin: number;
  active: boolean;
};

const h = columnHelper<Row>();
const columns = [
  h.accessor("sku", { header: "SKU" }),
  h.accessor("name", { header: "Artikel", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
  h.accessor("category", { header: "Kategorie" }),
  h.accessor("quotaGroup", { header: "Kontingentgruppe" }),
  h.accessor("supplier", { header: "Vorzugslieferant", cell: (c) => c.getValue() ?? <StatusBadge tone="warning">fehlt</StatusBadge> }),
  h.accessor("price", { header: "EK", meta: { align: "right" }, cell: (c) => formatCurrency(c.getValue()), enableGlobalFilter: false }),
  h.accessor("variants", { header: "Varianten", meta: { align: "right" }, enableGlobalFilter: false }),
  h.accessor("free", { header: "Frei", meta: { align: "right" }, enableGlobalFilter: false }),
  h.accessor("reserved", { header: "Reserviert", meta: { align: "right" }, enableGlobalFilter: false }),
  h.accessor("belowMin", {
    header: "Bestand",
    enableGlobalFilter: false,
    cell: (c) => (c.getValue() > 0 ? <StatusBadge tone="danger">{c.getValue()} unter Mindestbestand</StatusBadge> : <StatusBadge tone="success">ok</StatusBadge>),
  }),
  h.accessor("active", { header: "Status", enableGlobalFilter: false, cell: (c) => (c.getValue() ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Inaktiv</StatusBadge>) }),
];

export function ArticlesTable({ rows }: { rows: Row[] }) {
  return <DataTable data={rows} columns={columns} searchPlaceholder="SKU, Name, Kategorie …" rowHref={(r) => `/articles/${r.id}`} />;
}
