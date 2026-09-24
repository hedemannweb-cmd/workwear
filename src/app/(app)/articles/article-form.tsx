"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldHint } from "@/components/shared/form-sheet";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveArticleAction } from "@/modules/articles/actions";

export type ArticleFormValues = {
  sku: string;
  name: string;
  description: string | null;
  categoryId: string;
  quotaGroupId: string;
  manufacturer: string | null;
  imageUrl: string | null;
  isStockItem: boolean;
  active: boolean;
};

export function ArticleForm({
  id,
  defaults,
  categories,
  groups,
  onDone,
}: {
  id: string | null;
  defaults: ArticleFormValues;
  categories: Array<{ id: string; name: string; scale: string | null }>;
  groups: Array<{ id: string; name: string }>;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const [v, setV] = useState(defaults);
  return (
    <Card>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(() => saveArticleAction(id, v), {
              success: "Artikel gespeichert.",
              onSuccess: (d) => (id ? onDone?.() : router.push(`/articles/${d.id}`)),
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="a-sku">SKU / Artikelnummer</Label>
            <Input id="a-sku" value={v.sku} onChange={(e) => setV({ ...v, sku: e.target.value })} />
            <FieldHint error={fieldErrors.sku} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-name">Bezeichnung</Label>
            <Input id="a-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            <FieldHint error={fieldErrors.name} />
          </div>
          <div className="space-y-1">
            <Label>Kategorie</Label>
            <Select value={v.categoryId} onValueChange={(categoryId) => setV({ ...v, categoryId })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Bitte wählen" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} {c.scale ? `(Größen: ${c.scale})` : "(ohne Größen)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldHint error={fieldErrors.categoryId} />
          </div>
          <div className="space-y-1">
            <Label>Kontingentgruppe</Label>
            <Select value={v.quotaGroupId} onValueChange={(quotaGroupId) => setV({ ...v, quotaGroupId })}>
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
            <p className="text-xs text-muted-foreground">Auf welches Mitarbeiterkontingent die Ausgabe angerechnet wird.</p>
            <FieldHint error={fieldErrors.quotaGroupId} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-man">Hersteller</Label>
            <Input id="a-man" value={v.manufacturer ?? ""} onChange={(e) => setV({ ...v, manufacturer: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-img">Bild-URL (https)</Label>
            <Input id="a-img" value={v.imageUrl ?? ""} onChange={(e) => setV({ ...v, imageUrl: e.target.value || null })} />
            <FieldHint error={fieldErrors.imageUrl} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="a-desc">Beschreibung</Label>
            <Textarea id="a-desc" rows={2} value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value || null })} />
          </div>
          <div className="flex flex-wrap gap-6 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={v.isStockItem} onCheckedChange={(isStockItem) => setV({ ...v, isStockItem })} /> Lagerartikel (Mindestbestand wird überwacht)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} /> Aktiv
            </label>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              Speichern
            </Button>
            {onDone && (
              <Button type="button" variant="outline" onClick={onDone}>
                Abbrechen
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
