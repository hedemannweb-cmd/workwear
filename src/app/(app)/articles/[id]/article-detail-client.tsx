"use client";

import { Loader2, Pencil, Plus, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FieldHint } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createVariantsAction, saveArticleSupplierAction, updateVariantAction } from "@/modules/articles/actions";
import { ArticleForm, type ArticleFormValues } from "../article-form";

type Variant = { id: string; variantSku: string; size: string | null; color: string | null; barcode: string | null; minStock: number | null; active: boolean; physical: number; reserved: number; free: number };
type SupplierLink = { supplierId: string; name: string; supplierSku: string | null; purchasePrice: number | null; leadTimeDays: number | null; isPreferred: boolean };

export function ArticleDetailClient({
  article,
  variants,
  suppliers,
  scaleSizes,
  options,
  canManage,
}: {
  article: ArticleFormValues & { id: string };
  variants: Variant[];
  suppliers: SupplierLink[];
  scaleSizes: Array<{ id: string; value: string }>;
  options: { categories: Array<{ id: string; name: string; scale: string | null }>; groups: Array<{ id: string; name: string }>; suppliers: Array<{ id: string; name: string }> };
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [variantEdit, setVariantEdit] = useState<Variant | null>(null);
  const [supplierEdit, setSupplierEdit] = useState<SupplierLink | "new" | null>(null);

  return (
    <div className="space-y-6">
      {editing ? (
        <ArticleForm id={article.id} defaults={article} categories={options.categories} groups={options.groups} onDone={() => setEditing(false)} />
      ) : (
        canManage && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> Stammdaten bearbeiten
          </Button>
        )
      )}

      <Card>
        <CardHeader>
          <CardTitle>Varianten &amp; Bestand</CardTitle>
          <CardAction className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/inventory/movements?artikel=${article.id}`}>Bewegungen</Link>
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setMatrixOpen(true)}>
                <Plus className="size-4" /> Varianten anlegen
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent>
          {variants.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Varianten. Legen Sie Größen/Farben über „Varianten anlegen“ an.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variante</TableHead>
                    <TableHead>Farbe</TableHead>
                    <TableHead>Größe</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead className="text-right">Physisch</TableHead>
                    <TableHead className="text-right">Reserviert</TableHead>
                    <TableHead className="text-right">Frei</TableHead>
                    <TableHead className="text-right">Mindestbestand</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead className="w-10"><span className="sr-only">Aktionen</span></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map((v) => {
                    const below = v.minStock !== null && v.free < v.minStock;
                    return (
                      <TableRow key={v.id} className={cn(!v.active && "text-muted-foreground")}>
                        <TableCell className="font-mono text-xs">{v.variantSku}</TableCell>
                        <TableCell>{v.color ?? "–"}</TableCell>
                        <TableCell className="font-medium">{v.size ?? "–"}</TableCell>
                        <TableCell className="font-mono text-xs">{v.barcode ?? "–"}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.physical}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.reserved}</TableCell>
                        <TableCell className="text-right">
                          {v.free === 0 ? <StatusBadge tone="danger">0</StatusBadge> : below ? <StatusBadge tone="warning">{v.free}</StatusBadge> : <span className="tabular-nums">{v.free}</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{v.minStock ?? "–"}</TableCell>
                        <TableCell>{v.active ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Inaktiv</StatusBadge>}</TableCell>
                        {canManage && (
                          <TableCell>
                            <Button variant="ghost" size="icon" aria-label={`Variante ${v.variantSku} bearbeiten`} onClick={() => setVariantEdit(v)}>
                              <Pencil className="size-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lieferanten</CardTitle>
          {canManage && (
            <CardAction>
              <Button size="sm" variant="outline" onClick={() => setSupplierEdit("new")}>
                <Plus className="size-4" /> Lieferant zuordnen
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Kein Lieferant zugeordnet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lieferant</TableHead>
                  <TableHead>Lieferanten-Art.-Nr.</TableHead>
                  <TableHead className="text-right">Einkaufspreis</TableHead>
                  <TableHead className="text-right">Lieferzeit</TableHead>
                  <TableHead>Vorzug</TableHead>
                  {canManage && <TableHead className="w-10"><span className="sr-only">Aktionen</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.supplierId}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.supplierSku ?? "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(s.purchasePrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.leadTimeDays !== null ? `${s.leadTimeDays} Tage` : "–"}</TableCell>
                    <TableCell>{s.isPreferred && <StatusBadge tone="info" icon={Star}>Vorzugslieferant</StatusBadge>}</TableCell>
                    {canManage && (
                      <TableCell>
                        <Button variant="ghost" size="icon" aria-label="Bearbeiten" onClick={() => setSupplierEdit(s)}>
                          <Pencil className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {matrixOpen && <VariantMatrixDialog articleId={article.id} sizes={scaleSizes} onClose={() => setMatrixOpen(false)} />}
      {variantEdit && <VariantDialog articleId={article.id} variant={variantEdit} onClose={() => setVariantEdit(null)} />}
      {supplierEdit && (
        <SupplierLinkDialog
          articleId={article.id}
          link={supplierEdit === "new" ? null : supplierEdit}
          suppliers={options.suppliers.filter((s) => supplierEdit !== "new" || !suppliers.some((x) => x.supplierId === s.id))}
          onClose={() => setSupplierEdit(null)}
        />
      )}
    </div>
  );
}

function VariantMatrixDialog({ articleId, sizes, onClose }: { articleId: string; sizes: Array<{ id: string; value: string }>; onClose: () => void }) {
  const { run, pending } = useAction();
  const [color, setColor] = useState("");
  const [selected, setSelected] = useState<string[]>(sizes.map((s) => s.id));
  const [minStock, setMinStock] = useState("");
  const withoutSize = sizes.length === 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Varianten anlegen</DialogTitle>
          <DialogDescription>Legt für jede gewählte Größe eine Variante an. Bereits vorhandene Kombinationen werden übersprungen.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1">
            <Label htmlFor="m-color">Farbe (optional)</Label>
            <Input id="m-color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="z. B. Schwarz" />
          </div>
          {!withoutSize && (
            <div className="space-y-2">
              <Label>Größen</Label>
              <div className="flex flex-wrap gap-3">
                {sizes.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={selected.includes(s.id)}
                      onCheckedChange={(c) => setSelected((x) => (c ? [...x, s.id] : x.filter((y) => y !== s.id)))}
                    />
                    {s.value}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="m-min">Mindestbestand je Variante (optional)</Label>
            <Input id="m-min" type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || (!withoutSize && selected.length === 0)}
            onClick={async () => {
              const res = await run(
                () => createVariantsAction({ articleId, color: color || null, sizeIds: selected, withoutSize, minStock: minStock === "" ? null : Number(minStock) }),
                { success: (d) => `${d.created} Variante(n) angelegt.` },
              );
              if (res.ok) onClose();
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VariantDialog({ articleId, variant, onClose }: { articleId: string; variant: Variant; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const [barcode, setBarcode] = useState(variant.barcode ?? "");
  const [minStock, setMinStock] = useState(variant.minStock?.toString() ?? "");
  const [active, setActive] = useState(variant.active);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Variante {variant.variantSku}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1">
            <Label htmlFor="v-bc">Barcode</Label>
            <Input id="v-bc" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            <FieldHint error={fieldErrors.barcode} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-min">Mindestbestand</Label>
            <Input id="v-min" type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} onCheckedChange={setActive} /> Aktiv (inaktive Varianten können nicht mehr ausgegeben oder bestellt werden)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              const res = await run(() => updateVariantAction(articleId, variant.id, { barcode: barcode || null, minStock: minStock === "" ? null : Number(minStock), active }), {
                success: "Variante gespeichert.",
              });
              if (res.ok) onClose();
            }}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupplierLinkDialog({
  articleId,
  link,
  suppliers,
  onClose,
}: {
  articleId: string;
  link: SupplierLink | null;
  suppliers: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const { run, pending } = useAction();
  const [supplierId, setSupplierId] = useState(link?.supplierId ?? "");
  const [supplierSku, setSupplierSku] = useState(link?.supplierSku ?? "");
  const [price, setPrice] = useState(link?.purchasePrice?.toString() ?? "");
  const [lead, setLead] = useState(link?.leadTimeDays?.toString() ?? "");
  const [preferred, setPreferred] = useState(link?.isPreferred ?? suppliers.length > 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{link ? link.name : "Lieferant zuordnen"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {!link && (
            <div className="space-y-1">
              <Label>Lieferant</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Bitte wählen" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="l-sku">Lieferanten-Art.-Nr.</Label>
              <Input id="l-sku" value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="l-price">Einkaufspreis (€)</Label>
              <Input id="l-price" type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="l-lead">Lieferzeit (Tage)</Label>
              <Input id="l-lead" type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={preferred} onCheckedChange={setPreferred} /> Vorzugslieferant (Standard für Bestellungen und Kostenbewertung)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || !supplierId}
            onClick={async () => {
              const res = await run(
                () =>
                  saveArticleSupplierAction({
                    articleId,
                    supplierId,
                    supplierSku: supplierSku || null,
                    purchasePrice: price === "" ? null : Number(price),
                    leadTimeDays: lead === "" ? null : Number(lead),
                    isPreferred: preferred,
                  }),
                { success: "Lieferant gespeichert." },
              );
              if (res.ok) onClose();
            }}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
