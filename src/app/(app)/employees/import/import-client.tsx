"use client";

import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { commitEmployeeImportAction, previewEmployeeImportAction } from "@/modules/employees/actions";
import type { ImportPreview } from "@/modules/employees/server/import";

type Filter = "all" | "new" | "problems";

const RESULT_BADGE = {
  new: <StatusBadge tone="success">Neu</StatusBadge>,
  duplicate: <StatusBadge tone="neutral">Vorhanden</StatusBadge>,
  error: <StatusBadge tone="danger">Fehler</StatusBadge>,
};

export function EmployeeImportClient() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const { run, pending } = useAction();

  const formData = (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    return fd;
  };

  function choose(f: File | null) {
    setFile(f);
    setPreview(null);
    setFilter("all");
    if (!f) return;
    void run(() => previewEmployeeImportAction(formData(f)), { refresh: false, onSuccess: (p) => setPreview(p) }).then((res) => {
      if (!res.ok && inputRef.current) {
        inputRef.current.value = "";
        setFile(null);
      }
    });
  }

  function commit() {
    if (!file) return;
    void run(() => commitEmployeeImportAction(formData(file)), {
      success: (r) => `${r.created} Mitarbeiter angelegt${r.skipped ? `, ${r.skipped} Zeilen übersprungen` : ""}.`,
      onSuccess: () => router.push("/employees"),
      refresh: false,
    });
  }

  const rows = preview?.rows.filter((r) => filter === "all" || (filter === "new" ? r.result === "new" : r.result !== "new" || r.warnings.length > 0)) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Vorlage herunterladen</CardTitle>
            <CardDescription>Excel-Vorlage mit den passenden Spalten, Auswahllisten für Abteilung und Status und einem Blatt mit Hinweisen.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <a href="/api/employees/import-template" download>
                <Download className="size-4" /> Vorlage (.xlsx)
              </a>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2. Ausgefüllte Datei prüfen</CardTitle>
            <CardDescription>Die Datei wird zuerst nur geprüft. Gespeichert wird erst nach Ihrer Bestätigung.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              id="employee-import-file"
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={pending}>
              <Upload className="size-4" /> {file ? "Andere Datei wählen" : "Datei auswählen"}
            </Button>
            {file && (
              <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                <FileSpreadsheet className="size-4 shrink-0" />
                <span className="truncate">{file.name}</span>
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      {pending && !preview && <p className="text-sm text-muted-foreground">Datei wird geprüft …</p>}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>3. Vorschau</CardTitle>
            <CardDescription className="flex flex-wrap gap-2 pt-1">
              <StatusBadge tone="success">{preview.counts.new} neu</StatusBadge>
              <StatusBadge tone="neutral">{preview.counts.duplicate} bereits vorhanden</StatusBadge>
              <StatusBadge tone="danger">{preview.counts.error} fehlerhaft</StatusBadge>
              {preview.counts.warning > 0 && <StatusBadge tone="warning">{preview.counts.warning} mit Hinweis</StatusBadge>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1">
                {(
                  [
                    ["all", `Alle (${preview.rows.length})`],
                    ["new", "Nur neue"],
                    ["problems", "Nur Fehler und Hinweise"],
                  ] as const
                ).map(([key, label]) => (
                  <Button key={key} size="sm" variant={filter === key ? "secondary" : "ghost"} onClick={() => setFilter(key)}>
                    {label}
                  </Button>
                ))}
              </div>
              <Button onClick={commit} disabled={pending || preview.counts.new === 0}>
                {preview.counts.new === 0 ? "Keine neuen Mitarbeiter" : `${preview.counts.new} Mitarbeiter importieren`}
              </Button>
            </div>
            {preview.counts.error > 0 && preview.counts.new > 0 && (
              <p className="text-sm text-muted-foreground">Fehlerhafte Zeilen werden übersprungen. Sie können sie in Excel korrigieren und die Datei erneut prüfen.</p>
            )}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-right">Zeile</TableHead>
                    <TableHead>Ergebnis</TableHead>
                    <TableHead>Personalnr.</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Abteilung</TableHead>
                    <TableHead>Eintritt</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Meldungen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                        Keine Zeilen in dieser Ansicht.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow key={r.rowNumber}>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.rowNumber}</TableCell>
                      <TableCell>{RESULT_BADGE[r.result]}</TableCell>
                      <TableCell className="font-mono text-xs">{r.employeeNumber}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.department}</TableCell>
                      <TableCell>{r.entryDate ? formatDate(r.entryDate) : ""}</TableCell>
                      <TableCell>{r.status}</TableCell>
                      <TableCell className="min-w-64 whitespace-normal text-sm">
                        {r.errors.map((m) => (
                          <div key={m} className={r.result === "error" ? "text-destructive" : "text-muted-foreground"}>
                            {m}
                          </div>
                        ))}
                        {r.warnings.map((m) => (
                          <div key={m} className="text-amber-700 dark:text-amber-400">
                            {m}
                          </div>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
