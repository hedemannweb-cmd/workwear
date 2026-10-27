"use client";

import { ArrowLeftRight, Building2, EllipsisVertical, Loader2, Pencil, Ruler, Shirt, SlidersHorizontal, Undo2, UserX } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ReasonDialog } from "@/components/shared/reason-dialog";
import { ISSUE_STATUS, RESERVATION_STATUS, StatusOf } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime } from "@/lib/dates";
import { changeDepartmentAction, pseudonymizeEmployeeAction, setEmployeeSizesAction } from "@/modules/employees/actions";
import {
  adjustQuotaAction,
  cancelIssueAction,
  cancelReservationAction,
  exchangeClothingAction,
  issueClothingAction,
  returnClothingAction,
} from "@/modules/issues/actions";
import type { CatalogGroup } from "@/modules/issues/server/catalog";
import { randomUUID } from "@/lib/uuid";
import { IssueDialog } from "./issue-dialog";

// ───────────────────────────── Kopfzeilen-Aktionen ─────────────────────────────

export function EmployeeActions(props: {
  employeeId: string;
  employeeName: string;
  active: boolean;
  catalog: CatalogGroup[];
  available: Record<string, number | null>;
  quotaGroups: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  currentDepartmentId: string;
  year: number;
  perms: { issue: boolean; override: boolean; adjust: boolean; manage: boolean; changeDepartment: boolean; pseudonymize: boolean };
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Direkteinstieg aus der Schnellansicht der Suche (?ausgabe=1) öffnet den Ausgabedialog sofort
  const openFromSearch = searchParams.get("ausgabe") === "1";
  const [issueOpen, setIssueOpen] = useState(() => openFromSearch && props.active && props.perms.issue);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const { run, pending } = useAction();

  useEffect(() => {
    if (openFromSearch) router.replace(`/employees/${props.employeeId}`, { scroll: false });
  }, [openFromSearch, props.employeeId, router]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.perms.issue && (
        <Button onClick={() => setIssueOpen(true)} disabled={!props.active} title={props.active ? undefined : "Mitarbeiter ist nicht aktiv"}>
          <Shirt className="size-4" /> Kleidung ausgeben / bestellen
        </Button>
      )}
      {props.perms.manage && (
        <Button variant="outline" asChild>
          <Link href={`/employees/${props.employeeId}/edit`}>
            <Pencil className="size-4" /> Bearbeiten
          </Link>
        </Button>
      )}
      {(props.perms.adjust || props.perms.changeDepartment || props.perms.pseudonymize) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Weitere Aktionen">
              <EllipsisVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {props.perms.adjust && (
              <DropdownMenuItem onSelect={() => setAdjustOpen(true)}>
                <SlidersHorizontal className="size-4" /> Kontingent anpassen
              </DropdownMenuItem>
            )}
            {props.perms.changeDepartment && (
              <DropdownMenuItem onSelect={() => setDeptOpen(true)}>
                <Building2 className="size-4" /> Abteilung wechseln
              </DropdownMenuItem>
            )}
            {props.perms.pseudonymize && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    if (confirm("Personenbezogene Daten dieses ausgeschiedenen Mitarbeiters endgültig pseudonymisieren? Buchungen bleiben erhalten."))
                      void run(() => pseudonymizeEmployeeAction(props.employeeId), { success: "Mitarbeiter pseudonymisiert." });
                  }}
                  disabled={pending}
                >
                  <UserX className="size-4" /> Pseudonymisieren
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <IssueDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        employeeId={props.employeeId}
        employeeName={props.employeeName}
        catalog={props.catalog}
        available={props.available}
        canOverride={props.perms.override}
      />
      <AdjustQuotaDialog open={adjustOpen} onOpenChange={setAdjustOpen} employeeId={props.employeeId} groups={props.quotaGroups} year={props.year} />
      <ChangeDepartmentDialog
        open={deptOpen}
        onOpenChange={setDeptOpen}
        employeeId={props.employeeId}
        departments={props.departments.filter((d) => d.id !== props.currentDepartmentId)}
      />
    </div>
  );
}

function AdjustQuotaDialog({
  open,
  onOpenChange,
  employeeId,
  groups,
  year,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employeeId: string;
  groups: Array<{ id: string; name: string }>;
  year: number;
}) {
  const { run, pending, fieldErrors } = useAction();
  const [groupId, setGroupId] = useState("");
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kontingent anpassen ({year})</DialogTitle>
          <DialogDescription>Individuelle Anpassung für dieses Jahr. Wird mit Begründung im Audit Log protokolliert.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1">
            <Label>Kontingentgruppe</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Bitte wählen" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="delta">Änderung (z. B. +2 oder −1)</Label>
            <Input id="delta" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} min={-50} max={50} />
            {fieldErrors.quantityDelta && <p className="text-sm text-destructive">{fieldErrors.quantityDelta[0]}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="adj-reason">Begründung (Pflicht)</Label>
            <Textarea id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
            {fieldErrors.reason && <p className="text-sm text-destructive">{fieldErrors.reason[0]}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || !groupId || reason.trim().length < 5 || !Number(delta)}
            onClick={async () => {
              const res = await run(
                () => adjustQuotaAction({ employeeId, quotaGroupId: groupId, year, quantityDelta: Number(delta), reason }),
                { success: "Kontingent angepasst." },
              );
              if (res.ok) {
                onOpenChange(false);
                setReason("");
                setDelta("1");
              }
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeDepartmentDialog({
  open,
  onOpenChange,
  employeeId,
  departments,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employeeId: string;
  departments: Array<{ id: string; name: string }>;
}) {
  const { run, pending } = useAction();
  const [departmentId, setDepartmentId] = useState("");
  const [validFrom, setValidFrom] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" }));
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abteilung wechseln</DialogTitle>
          <DialogDescription>
            Der Wechsel wird historisiert. Bisherige Ausgaben bleiben der alten Abteilung zugeordnet; das Kontingent richtet sich nach der
            Abteilung am Stichtag.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1">
            <Label>Neue Abteilung</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Bitte wählen" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="validFrom">Gültig ab</Label>
            <Input id="validFrom" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dept-reason">Begründung (Pflicht)</Label>
            <Textarea id="dept-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || !departmentId || reason.trim().length < 5}
            onClick={async () => {
              const res = await run(() => changeDepartmentAction({ employeeId, departmentId, validFrom, reason }), {
                success: "Abteilung gewechselt.",
              });
              if (res.ok) onOpenChange(false);
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Wechseln
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Größen ─────────────────────────────

export type SizeScaleDto = { id: string; name: string; sizes: Array<{ id: string; value: string }> };
export type EmployeeSizeDto = { sizeScaleId: string; categoryId: string | null; sizeId: string };

export function SizesEditor({
  employeeId,
  scales,
  categories,
  current,
  canEdit,
}: {
  employeeId: string;
  scales: SizeScaleDto[];
  categories: Array<{ id: string; name: string; sizeScaleId: string | null }>;
  current: EmployeeSizeDto[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const key = (scaleId: string, categoryId: string | null) => `${scaleId}|${categoryId ?? ""}`;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(current.map((c) => [key(c.sizeScaleId, c.categoryId), c.sizeId])),
  );

  const label = (scaleId: string, categoryId: string | null) => {
    const v = current.find((c) => c.sizeScaleId === scaleId && c.categoryId === categoryId);
    return v ? scales.find((s) => s.id === scaleId)?.sizes.find((z) => z.id === v.sizeId)?.value : undefined;
  };

  const overrides = current.filter((c) => c.categoryId);

  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {scales.map((s) => (
          <div key={s.id} className="contents">
            <dt className="text-muted-foreground">{s.name}</dt>
            <dd className="font-medium">{label(s.id, null) ?? <span className="font-normal text-muted-foreground">nicht hinterlegt</span>}</dd>
          </div>
        ))}
        {overrides.map((o) => (
          <div key={key(o.sizeScaleId, o.categoryId)} className="contents">
            <dt className="text-muted-foreground">{categories.find((c) => c.id === o.categoryId)?.name}</dt>
            <dd className="font-medium">{label(o.sizeScaleId, o.categoryId)}</dd>
          </div>
        ))}
      </dl>
      {canEdit && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Ruler className="size-4" /> Größen bearbeiten
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Größen</DialogTitle>
            <DialogDescription>Standardgröße je Größenskala; optional abweichende Größe je Kategorie (z. B. Jacke eine Nummer größer).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {scales.map((s) => (
              <div key={s.id} className="space-y-2 rounded-md border p-3">
                <SizeSelect label={`${s.name} (Standard)`} scale={s} value={values[key(s.id, null)] ?? ""} onChange={(v) => setValues((x) => ({ ...x, [key(s.id, null)]: v }))} />
                {categories
                  .filter((c) => c.sizeScaleId === s.id)
                  .map((c) => (
                    <SizeSelect
                      key={c.id}
                      label={`${c.name} (abweichend)`}
                      scale={s}
                      allowEmpty="wie Standard"
                      value={values[key(s.id, c.id)] ?? ""}
                      onChange={(v) => setValues((x) => ({ ...x, [key(s.id, c.id)]: v }))}
                    />
                  ))}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                const sizes = [
                  ...scales.map((s) => ({ sizeScaleId: s.id, categoryId: null, sizeId: values[key(s.id, null)] || null })),
                  ...categories
                    .filter((c) => c.sizeScaleId)
                    .map((c) => ({ sizeScaleId: c.sizeScaleId!, categoryId: c.id, sizeId: values[key(c.sizeScaleId!, c.id)] || null })),
                ];
                const res = await run(() => setEmployeeSizesAction(employeeId, { sizes }), { success: "Größen gespeichert." });
                if (res.ok) setOpen(false);
              }}
            >
              {pending && <Loader2 className="size-4 animate-spin" />} Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SizeSelect({
  label,
  scale,
  value,
  onChange,
  allowEmpty = "nicht hinterlegt",
}: {
  label: string;
  scale: SizeScaleDto;
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm font-normal">{label}</Label>
      <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{allowEmpty}</SelectItem>
          {scale.sizes.map((z) => (
            <SelectItem key={z.id} value={z.id}>
              {z.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ───────────────────────────── Reservierungen ─────────────────────────────

export type ReservationDto = {
  id: string;
  status: string;
  quantity: number;
  quotaYear: number;
  label: string;
  articleVariantId: string;
  createdAt: string;
  free: number;
  order: { id: string; orderNumber: string; expectedDeliveryDate: string | null } | null;
  location: string | null;
};

export function ReservationsList({
  employeeId,
  reservations,
  canIssue,
  canCancel,
  active,
}: {
  employeeId: string;
  reservations: ReservationDto[];
  canIssue: boolean;
  canCancel: boolean;
  active: boolean;
}) {
  const { run, pending } = useAction();
  if (reservations.length === 0) return <p className="text-sm text-muted-foreground">Keine offenen Bestellungen.</p>;
  return (
    <ul className="divide-y text-sm">
      {reservations.map((r) => {
        const issuable = active && (r.status === "RECEIVED" || (r.status === "PENDING" && r.free >= r.quantity));
        return (
          <li key={r.id} className="space-y-1 py-2">
            <div className="flex items-start gap-2">
              <span className="tabular-nums">{r.quantity} ×</span>
              <span className="flex-1 font-medium">{r.label}</span>
              <StatusOf map={RESERVATION_STATUS} status={r.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
              <span>angefordert {formatDate(r.createdAt)}</span>
              {r.order && (
                <Link href={`/orders/${r.order.id}`} className="underline-offset-2 hover:underline">
                  {r.order.orderNumber}
                  {r.order.expectedDeliveryDate && ` · erwartet ${formatDate(r.order.expectedDeliveryDate)}`}
                </Link>
              )}
              {r.location && <span>liegt bereit: {r.location}</span>}
              {r.status === "PENDING" && r.free >= r.quantity && <span className="text-success-foreground">jetzt am Lager</span>}
            </div>
            <div className="flex gap-2 pl-6">
              {canIssue && issuable && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        issueClothingAction({
                          employeeId,
                          clientRequestId: randomUUID(),
                          items: [{ articleVariantId: r.articleVariantId, quantity: r.quantity, reservationId: r.id }],
                        }),
                      { success: (d) => `Ausgabe ${d.issueNumber} gebucht.` },
                    )
                  }
                >
                  Ausgeben
                </Button>
              )}
              {canCancel && (
                <ReasonDialog
                  trigger={
                    <Button size="sm" variant="ghost">
                      Stornieren
                    </Button>
                  }
                  title="Reservierung stornieren"
                  description={
                    r.status === "ORDERED"
                      ? "Die Ware ist bereits bestellt. Das Kontingent wird frei, die bestellte Menge geht bei Lieferung ins Lager."
                      : "Das reservierte Kontingent wird wieder frei."
                  }
                  confirmLabel="Stornieren"
                  destructive
                  pending={pending}
                  onConfirm={(reason) => run(() => cancelReservationAction(employeeId, { reservationId: r.id, reason }), { success: "Reservierung storniert." })}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────────── Historie ─────────────────────────────

export type IssueDto = {
  id: string;
  issueNumber: string;
  issuedAt: string;
  status: string;
  issuedBy: string;
  cancelReason: string | null;
  cancelledBy: string | null;
  notes: string | null;
  /** serverseitig berechnet: darf der aktuelle Benutzer stornieren? (verbindlich prüft der Server erneut) */
  cancellable: boolean;
  items: Array<{
    id: string;
    label: string;
    quantity: number;
    quotaYear: number;
    location: string;
    returned: number;
    returns: Array<{ returnNumber: string; returnedAt: string; quantity: number; type: string }>;
    alternatives: Array<{ id: string; label: string; free: number }>;
  }>;
};

const RETURN_LABEL: Record<string, string> = {
  RETURN_TO_STOCK: "Rückgabe",
  EXCHANGE: "Umtausch",
  DEFECTIVE: "Reklamation",
  WRITE_OFF: "Abschreibung",
};

export function IssueHistory({
  employeeId,
  issues,
  canReturn,
}: {
  employeeId: string;
  issues: IssueDto[];
  canReturn: boolean;
}) {
  const { run, pending } = useAction();
  const [returnFor, setReturnFor] = useState<{ issue: IssueDto; item: IssueDto["items"][number] } | null>(null);

  if (issues.length === 0) return <p className="text-sm text-muted-foreground">Noch keine Ausgaben.</p>;
  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Beleg</TableHead>
              <TableHead>Artikel</TableHead>
              <TableHead className="text-right">Menge</TableHead>
              <TableHead>Jahr</TableHead>
              <TableHead>Lager</TableHead>
              <TableHead>Ausgegeben von</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Aktionen</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.flatMap((issue) =>
              issue.items.map((item, idx) => (
                <TableRow key={item.id} className={issue.status === "CANCELLED" ? "text-muted-foreground" : undefined}>
                  <TableCell className="whitespace-nowrap">{idx === 0 ? formatDateTime(issue.issuedAt) : ""}</TableCell>
                  <TableCell className="whitespace-nowrap">{idx === 0 ? issue.issueNumber : ""}</TableCell>
                  <TableCell>
                    <div>{item.label}</div>
                    {item.returns.map((r) => (
                      <div key={r.returnNumber} className="text-xs text-muted-foreground">
                        {RETURN_LABEL[r.type]} {r.quantity} × am {formatDate(r.returnedAt)} ({r.returnNumber})
                      </div>
                    ))}
                    {idx === 0 && issue.notes && <div className="text-xs text-muted-foreground">{issue.notes}</div>}
                    {idx === 0 && issue.cancelReason && (
                      <div className="text-xs">Storniert von {issue.cancelledBy}: {issue.cancelReason}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="tabular-nums">{item.quotaYear}</TableCell>
                  <TableCell>{item.location}</TableCell>
                  <TableCell>{idx === 0 ? issue.issuedBy : ""}</TableCell>
                  <TableCell>{idx === 0 && <StatusOf map={ISSUE_STATUS} status={issue.status} />}</TableCell>
                  <TableCell>
                    {issue.status === "COMPLETED" && (canReturn || (idx === 0 && issue.cancellable)) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Aktionen zur Ausgabe">
                            <EllipsisVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canReturn && item.returned < item.quantity && (
                            <DropdownMenuItem onSelect={() => setReturnFor({ issue, item })}>
                              <Undo2 className="size-4" /> Rückgabe / Umtausch
                            </DropdownMenuItem>
                          )}
                          {idx === 0 && issue.cancellable && issue.items.every((i) => i.returned === 0) && (
                            <ReasonDialog
                              trigger={
                                <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                                  Ausgabe stornieren
                                </DropdownMenuItem>
                              }
                              title={`Ausgabe ${issue.issueNumber} stornieren`}
                              description="Die Ware geht zurück in den Bestand, das Kontingent wird wieder frei. Nur für Fehlbuchungen verwenden."
                              confirmLabel="Stornieren"
                              destructive
                              pending={pending}
                              onConfirm={(reason) => run(() => cancelIssueAction(employeeId, { issueId: issue.id, reason }), { success: "Ausgabe storniert." })}
                            />
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </div>
      {returnFor && <ReturnDialog employeeId={employeeId} target={returnFor} onClose={() => setReturnFor(null)} />}
    </>
  );
}

function ReturnDialog({
  employeeId,
  target,
  onClose,
}: {
  employeeId: string;
  target: { issue: IssueDto; item: IssueDto["items"][number] };
  onClose: () => void;
}) {
  const { run, pending } = useAction();
  const open = target.item.quantity - target.item.returned;
  const [type, setType] = useState<"EXCHANGE" | "RETURN_TO_STOCK" | "DEFECTIVE" | "WRITE_OFF">("EXCHANGE");
  const [quantity, setQuantity] = useState(1);
  const [newVariantId, setNewVariantId] = useState("");
  const [unworn, setUnworn] = useState(false);
  const [reason, setReason] = useState("");

  const hints: Record<typeof type, string> = {
    EXCHANGE: "Alte Größe zurück ins Lager, neue Größe wird ausgegeben. Das Kontingent wird nicht erneut belastet.",
    RETURN_TO_STOCK: "Nur ungetragene Ware. Bestand wird erhöht, das Kontingent wird gutgeschrieben.",
    DEFECTIVE: "Produktionsfehler: Ware geht ins Ausschusslager (falls eingerichtet), Kontingent wird gutgeschrieben.",
    WRITE_OFF: "Verschlissen oder verloren: keine Lagerbuchung, keine Kontingent-Gutschrift.",
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rückgabe / Umtausch</DialogTitle>
          <DialogDescription>
            {target.item.label} aus {target.issue.issueNumber} – noch {open} Stück rückgabefähig
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1">
            <Label>Art</Label>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EXCHANGE">Umtausch (andere Größe)</SelectItem>
                <SelectItem value="RETURN_TO_STOCK">Rückgabe ins Lager (ungetragen)</SelectItem>
                <SelectItem value="DEFECTIVE">Reklamation / defekt</SelectItem>
                <SelectItem value="WRITE_OFF">Abschreibung (verschlissen/verloren)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{hints[type]}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ret-qty">Menge</Label>
            <Input id="ret-qty" type="number" min={1} max={open} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(open, Number(e.target.value) || 1)))} />
          </div>
          {type === "EXCHANGE" && (
            <div className="space-y-1">
              <Label>Neue Variante</Label>
              <Select value={newVariantId} onValueChange={setNewVariantId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Bitte wählen" />
                </SelectTrigger>
                <SelectContent>
                  {target.item.alternatives.map((a) => (
                    <SelectItem key={a.id} value={a.id} disabled={a.free < quantity}>
                      {a.label} – {a.free > 0 ? `${a.free} am Lager` : "nicht am Lager"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "RETURN_TO_STOCK" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={unworn} onCheckedChange={(v) => setUnworn(v === true)} /> Ware ist ungetragen und wiederverwendbar
            </label>
          )}
          <div className="space-y-1">
            <Label htmlFor="ret-reason">Grund / Notiz</Label>
            <Textarea id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || (type === "EXCHANGE" && !newVariantId) || (type === "RETURN_TO_STOCK" && !unworn)}
            onClick={async () => {
              const res =
                type === "EXCHANGE"
                  ? await run(
                      () =>
                        exchangeClothingAction({
                          employeeId,
                          clientRequestId: randomUUID(),
                          issueItemId: target.item.id,
                          quantity,
                          newArticleVariantId: newVariantId,
                          reason: reason || undefined,
                        }),
                      { success: "Umtausch gebucht." },
                    )
                  : await run(
                      () =>
                        returnClothingAction({
                          employeeId,
                          clientRequestId: randomUUID(),
                          confirmUnworn: unworn,
                          items: [{ issueItemId: target.item.id, quantity, returnType: type, reason: reason || undefined }],
                        }),
                      { success: "Rückgabe gebucht." },
                    );
              if (res.ok) onClose();
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            <ArrowLeftRight className="size-4" /> Buchen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
