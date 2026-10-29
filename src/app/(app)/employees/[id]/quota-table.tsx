"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

export type QuotaRow = {
  quotaGroupId: string;
  quotaGroupName: string;
  quotaRelevant: boolean;
  base: number;
  baseExplanation: string;
  adjustments: number;
  issued: number;
  reserved: number;
  available: number | null;
  overdrawn: boolean;
  minIntervalMonths: number | null;
  /** gesetzt, solange der Mindestabstand eine Ausgabe sperrt */
  nextEligibleAt: string | null;
  ledger: Array<{ date: string | null; kind: string; effect: number; label: string }>;
};

/** Kontingent-Tabelle (Vorgabe 23): Anspruch | Anpassung | Erhalten | Reserviert | Verfügbar, Klick öffnet den Nachweis. */
export function QuotaTable({ rows, year }: { rows: QuotaRow[]; year: number }) {
  const [selected, setSelected] = useState<QuotaRow | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artikel</TableHead>
              <TableHead className="text-right">Anspruch</TableHead>
              <TableHead className="text-right">Anpassung</TableHead>
              <TableHead className="text-right">Erhalten</TableHead>
              <TableHead className="text-right">Reserviert</TableHead>
              <TableHead className="text-right">Verfügbar</TableHead>
              <TableHead className="w-8">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.quotaGroupId}
                className="cursor-pointer"
                tabIndex={0}
                onClick={() => setSelected(r)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(r)}
                aria-label={`Nachweis für ${r.quotaGroupName} anzeigen`}
              >
                <TableCell className="font-medium">{r.quotaGroupName}</TableCell>
                <TableCell className="text-right tabular-nums">{r.quotaRelevant ? r.base : "–"}</TableCell>
                <TableCell className={cn("text-right tabular-nums", r.adjustments !== 0 && "font-medium")}>
                  {r.quotaRelevant ? formatSigned(r.adjustments) : "–"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.issued}</TableCell>
                <TableCell className="text-right tabular-nums">{r.reserved}</TableCell>
                <TableCell className="text-right">
                  {!r.quotaRelevant ? (
                    <span className="text-sm text-muted-foreground">ohne Kontingent</span>
                  ) : r.overdrawn ? (
                    <StatusBadge tone="danger">überschritten</StatusBadge>
                  ) : r.nextEligibleAt ? (
                    <StatusBadge tone="warning">
                      wieder ab {formatDate(r.nextEligibleAt)}
                    </StatusBadge>
                  ) : r.available === 0 ? (
                    <StatusBadge tone="neutral" icon={null}>0</StatusBadge>
                  ) : (
                    <StatusBadge tone="success" icon={null} className="tabular-nums">{r.available}</StatusBadge>
                  )}
                </TableCell>
                <TableCell>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {selected.quotaGroupName} – Kontingent {year}
                </SheetTitle>
                <SheetDescription>Nachweis aller Buchungen, die das verfügbare Kontingent bestimmen.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <ol className="divide-y rounded-md border text-sm">
                  {selected.ledger.map((e, i) => (
                    <li key={i} className="flex items-start gap-3 px-3 py-2">
                      <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{e.date ? formatDate(e.date) : ""}</span>
                      <span className="flex-1">{e.label}</span>
                      <span className={cn("shrink-0 font-medium tabular-nums", e.effect < 0 ? "text-danger-foreground" : "text-success-foreground")}>
                        {e.kind === "BASE" ? e.effect : formatSigned(e.effect)}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm font-medium">
                  <span>Verfügbar</span>
                  <span className="tabular-nums">
                    {selected.quotaRelevant ? selected.available : "unbegrenzt"}
                    {selected.overdrawn && " (überschritten)"}
                    {selected.nextEligibleAt && ` (wieder ab ${formatDate(selected.nextEligibleAt)})`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Verfügbar = Anspruch + Anpassungen − Erhalten (abzüglich Gutschriften aus Rückgaben) − aktive Reservierungen.
                  {selected.minIntervalMonths &&
                    ` Zusätzlich gilt ein Mindestabstand von ${selected.minIntervalMonths} Monaten zwischen zwei Ausgaben (jahresübergreifend; ein Umtausch setzt die Frist nicht neu).`}
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
