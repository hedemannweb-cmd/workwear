"use client";

import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Gemeinsame Feature-Auswahl aller Listen: Sortierung, Volltextfilter, Seiten. */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumn<T extends RowData> = ColumnDef<DataTableFeatures, T, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function columnHelper<T extends RowData>() {
  return createColumnHelper<DataTableFeatures, T>();
}

export function DataTable<T extends RowData>({
  data,
  columns,
  searchPlaceholder = "Suchen …",
  rowHref,
  pageSize = 25,
  emptyMessage = "Keine Einträge gefunden.",
  toolbar,
  dense,
}: {
  data: T[];
  columns: DataTableColumn<T>[];
  searchPlaceholder?: string | null;
  /** Zeile ist klickbar und navigiert zu dieser URL */
  rowHref?: (row: T) => string;
  pageSize?: number;
  emptyMessage?: string;
  toolbar?: React.ReactNode;
  dense?: boolean;
}) {
  const router = useRouter();
  const [initialState] = useState(() => ({ pagination: { pageIndex: 0, pageSize } }));
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    initialState,
    globalFilterFn: "includesString",
  });

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: size } = table.state.pagination;

  return (
    <div className="space-y-3">
      {(searchPlaceholder !== null || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder !== null && (
            <div className="relative w-full max-w-sm">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={String(table.state.globalFilter ?? "")}
                onChange={(e) => {
                  table.setGlobalFilter(e.target.value);
                  table.setPageIndex(0);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="pl-8"
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const meta = header.column.columnDef.meta as { align?: "right" } | undefined;
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(meta?.align === "right" && "text-right")}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn("inline-flex items-center gap-1 hover:text-foreground", meta?.align === "right" && "flex-row-reverse")}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" && <ArrowUp className="size-3" aria-hidden />}
                          {sorted === "desc" && <ArrowDown className="size-3" aria-hidden />}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const href = rowHref?.(row.original);
                return (
                  <TableRow
                    key={row.id}
                    className={cn(href && "cursor-pointer")}
                    onClick={href ? () => router.push(href) : undefined}
                  >
                    {row.getAllCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as { align?: "right" } | undefined;
                      return (
                        <TableCell key={cell.id} className={cn(dense && "py-1.5", meta?.align === "right" && "text-right tabular-nums")}>
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {filteredCount > size && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {pageIndex * size + 1}–{Math.min((pageIndex + 1) * size, filteredCount)} von {filteredCount}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft className="size-4" /> Zurück
            </Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Weiter <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
