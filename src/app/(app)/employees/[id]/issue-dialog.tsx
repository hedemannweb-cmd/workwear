"use client";

import { Loader2, Minus, PackageCheck, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { issueClothingAction, reserveClothingAction } from "@/modules/issues/actions";
import type { CatalogGroup, CatalogVariant } from "@/modules/issues/server/catalog";
import { randomUUID } from "@/lib/uuid";

type Line = {
  key: string;
  groupId: string;
  variantId: string;
  label: string;
  quantity: number;
  mode: "issue" | "order";
};

/**
 * Ausgabe oder Bestellung in möglichst wenigen Klicks (Vorgabe 48):
 * Gruppe → Größe (Mitarbeitergröße vorgewählt, Bestand an jedem Größen-Button) → Ausgeben/Bestellen.
 * Die Oberfläche zeigt nur Hinweise; die verbindliche Prüfung passiert serverseitig im Domänenprozess.
 */
export function IssueDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  catalog,
  available,
  nextEligible,
  canOverride,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  catalog: CatalogGroup[];
  /** verfügbares Kontingent je Gruppe im laufenden Jahr (null = unbegrenzt) */
  available: Record<string, number | null>;
  /** Gruppen, die der Mindestabstand derzeit sperrt → frühester Ausgabetag (ISO) */
  nextEligible: Record<string, string>;
  canOverride: boolean;
}) {
  const { run, pending } = useAction();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [lines, setLines] = useState<Line[]>([]);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const group = catalog.find((g) => g.id === groupId) ?? null;
  const article = group?.articles.find((a) => a.id === articleId) ?? (group?.articles.length === 1 ? group.articles[0] : null) ?? null;
  const variant = article?.variants.find((v) => v.id === variantId) ?? null;

  const usedInCart = (gid: string) => lines.filter((l) => l.groupId === gid).reduce((s, l) => s + l.quantity, 0);
  const remaining = (gid: string) => {
    const a = available[gid];
    return a === null || a === undefined ? (catalog.find((g) => g.id === gid)?.isQuotaRelevant === false ? Infinity : 0) : a - usedInCart(gid);
  };

  function reset() {
    setGroupId(null);
    setArticleId(null);
    setVariantId(null);
    setQuantity(1);
    setLines([]);
    setOverride(false);
    setOverrideReason("");
  }

  function selectGroup(id: string) {
    setGroupId(id);
    const g = catalog.find((x) => x.id === id);
    const art = g?.articles.length === 1 ? g.articles[0] : null;
    setArticleId(art?.id ?? null);
    setVariantId(art ? preferredVariant(art.variants)?.id ?? null : null);
    setQuantity(1);
  }

  function currentLine(): Line | null {
    if (!group || !article || !variant || quantity < 1) return null;
    const freeLeft = variant.free - lines.filter((l) => l.variantId === variant.id && l.mode === "issue").reduce((s, l) => s + l.quantity, 0);
    return {
      key: "pending",
      groupId: group.id,
      variantId: variant.id,
      label: [article.name, variant.color, variant.size].filter(Boolean).join(" · "),
      quantity,
      mode: freeLeft >= quantity ? "issue" : "order",
    };
  }

  const pendingLine = currentLine();
  const allLines = pendingLine ? [...lines, pendingLine] : lines;

  const demand = new Map<string, number>();
  for (const l of allLines) demand.set(l.groupId, (demand.get(l.groupId) ?? 0) + l.quantity);
  const exceeded = [...demand].filter(([gid, qty]) => {
    const a = available[gid];
    return a !== null && a !== undefined && qty > a;
  });

  const orderExceeds = exceeded.some(([gid]) => allLines.some((l) => l.groupId === gid && l.mode === "order"));
  const needsOverride = exceeded.length > 0;
  const blocked = allLines.length === 0 || (needsOverride && (!canOverride || !override || overrideReason.trim().length < 5 || orderExceeds));

  function addLine() {
    const l = currentLine();
    if (!l) return;
    setLines((ls) => [...ls, { ...l, key: randomUUID() }]);
    setVariantId(null);
    setQuantity(1);
  }

  async function submit() {
    const issueLines = allLines.filter((l) => l.mode === "issue");
    const orderLines = allLines.filter((l) => l.mode === "order");
    let ok = true;
    if (issueLines.length) {
      const res = await run(
        () =>
          issueClothingAction({
            employeeId,
            clientRequestId: randomUUID(),
            items: issueLines.map((l) => ({ articleVariantId: l.variantId, quantity: l.quantity })),
            override: needsOverride && override ? { reason: overrideReason.trim() } : undefined,
          }),
        { success: (d) => `Ausgabe ${d.issueNumber} gebucht.` },
      );
      ok = res.ok;
    }
    if (ok && orderLines.length) {
      const res = await run(
        () =>
          reserveClothingAction({
            employeeId,
            clientRequestId: randomUUID(),
            items: orderLines.map((l) => ({ articleVariantId: l.variantId, quantity: l.quantity })),
          }),
        { success: `${orderLines.length === 1 ? "Bestellung" : `${orderLines.length} Bestellungen`} angefordert – Kontingent ist reserviert.` },
      );
      ok = res.ok;
    }
    if (ok) {
      reset();
      onOpenChange(false);
    }
  }

  const issueCount = allLines.filter((l) => l.mode === "issue").length;
  const orderCount = allLines.filter((l) => l.mode === "order").length;
  const submitLabel =
    allLines.length > 1
      ? `${allLines.length} Positionen buchen`
      : issueCount === 1
        ? "Ausgeben"
        : orderCount === 1
          ? "Bestellen"
          : "Buchen";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Kleidung ausgeben / bestellen</DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        <section aria-label="Kontingentgruppe" className="space-y-2">
          <h3 className="text-sm font-medium">1. Was?</h3>
          <div className="flex flex-wrap gap-2">
            {catalog.map((g) => {
              const r = remaining(g.id);
              return (
                <Button
                  key={g.id}
                  type="button"
                  variant={groupId === g.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => selectGroup(g.id)}
                  aria-pressed={groupId === g.id}
                >
                  {g.name}
                  <span className={cn("rounded px-1 text-xs", groupId === g.id ? "bg-primary-foreground/20" : "bg-muted")}>
                    {r === Infinity ? "frei" : `${Math.max(0, r)} verfügbar`}
                  </span>
                </Button>
              );
            })}
          </div>
        </section>

        {group && group.articles.length > 1 && (
          <section aria-label="Artikel" className="space-y-2">
            <h3 className="text-sm font-medium">Artikel</h3>
            <div className="flex flex-wrap gap-2">
              {group.articles.map((a) => (
                <Button
                  key={a.id}
                  type="button"
                  size="sm"
                  variant={article?.id === a.id ? "default" : "outline"}
                  onClick={() => {
                    setArticleId(a.id);
                    setVariantId(preferredVariant(a.variants)?.id ?? null);
                  }}
                >
                  {a.name} <span className="text-xs opacity-70">{a.sku}</span>
                </Button>
              ))}
            </div>
          </section>
        )}

        {article && (
          <section aria-label="Größe" className="space-y-2">
            <h3 className="text-sm font-medium">2. Größe / Variante</h3>
            {groupByColor(article.variants).map(([color, variants]) => (
              <div key={color} className="space-y-1">
                {color && <div className="text-xs text-muted-foreground">{color}</div>}
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVariantId(v.id)}
                      aria-pressed={variantId === v.id}
                      className={cn(
                        "flex min-w-16 flex-col items-center rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted",
                        variantId === v.id && "border-primary bg-primary/5 ring-2 ring-primary/30",
                        v.preferred && variantId !== v.id && "border-primary/50",
                      )}
                    >
                      <span className="font-medium">{v.size ?? "Einheitsgröße"}</span>
                      <span className={cn("text-xs", v.free > 0 ? "text-success-foreground" : "text-danger-foreground")}>
                        {v.free > 0 ? `${v.free} am Lager` : "nicht am Lager"}
                      </span>
                      {v.preferred && <span className="text-[10px] text-primary">Mitarbeitergröße</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {variant && (
          <section aria-label="Menge" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="qty">3. Menge</Label>
              <div className="flex items-center gap-1">
                <Button type="button" size="icon" variant="outline" aria-label="Weniger" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                  <Minus className="size-4" />
                </Button>
                <Input
                  id="qty"
                  type="number"
                  min={1}
                  max={99}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                  className="w-16 text-center"
                />
                <Button type="button" size="icon" variant="outline" aria-label="Mehr" onClick={() => setQuantity((q) => Math.min(99, q + 1))}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
            {pendingLine && (
              <div className="pb-2 text-sm">
                {pendingLine.mode === "issue" ? (
                  <StatusBadge tone="success" icon={PackageCheck}>Wird ausgegeben</StatusBadge>
                ) : (
                  <StatusBadge tone="info" icon={ShoppingCart}>
                    {variant.free > 0 ? `Nur ${variant.free} am Lager – wird bestellt` : "Nicht am Lager – wird bestellt"}
                  </StatusBadge>
                )}
              </div>
            )}
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={addLine} disabled={!pendingLine}>
              <Plus className="size-4" /> Weitere Position
            </Button>
          </section>
        )}

        {lines.length > 0 && (
          <section aria-label="Positionen" className="space-y-1 rounded-md border p-2">
            <h3 className="px-1 text-sm font-medium">Positionen</h3>
            <ul className="divide-y">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-2 px-1 py-1.5 text-sm">
                  <span className="tabular-nums">{l.quantity} ×</span>
                  <span className="flex-1">{l.label}</span>
                  {l.mode === "issue" ? <StatusBadge tone="success">Ausgabe</StatusBadge> : <StatusBadge tone="info">Bestellung</StatusBadge>}
                  <Button type="button" variant="ghost" size="icon" aria-label="Position entfernen" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {needsOverride && (
          <section className="space-y-2 rounded-md border border-danger-foreground/30 bg-danger p-3 text-sm text-danger-foreground" role="alert">
            <p className="font-medium">
              Kontingent überschritten:{" "}
              {exceeded
                .map(([gid]) => {
                  const name = catalog.find((g) => g.id === gid)?.name;
                  return nextEligible[gid] ? `${name} (Mindestabstand, wieder ab ${formatDate(nextEligible[gid])})` : name;
                })
                .join(", ")}
            </p>
            {orderExceeds ? (
              <p>Bestellungen über das Kontingent sind nicht möglich. Bitte zuerst das Kontingent anpassen.</p>
            ) : canOverride ? (
              <div className="space-y-2 text-foreground">
                <label className="flex items-center gap-2">
                  <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} />
                  Sonderfreigabe erteilen (wird als Kontingentanpassung protokolliert)
                </label>
                {override && (
                  <Textarea placeholder="Begründung (Pflicht)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} maxLength={500} />
                )}
              </div>
            ) : (
              <p>Eine Sonderfreigabe kann nur ein Manager oder Administrator erteilen.</p>
            )}
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={blocked || pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function preferredVariant(variants: CatalogVariant[]) {
  return variants.find((v) => v.preferred) ?? (variants.length === 1 ? variants[0] : undefined);
}

function groupByColor(variants: CatalogVariant[]): Array<[string, CatalogVariant[]]> {
  const map = new Map<string, CatalogVariant[]>();
  for (const v of variants) {
    const key = v.color ?? "";
    map.set(key, [...(map.get(key) ?? []), v]);
  }
  return [...map];
}
