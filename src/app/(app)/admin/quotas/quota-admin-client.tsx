"use client";

import { Loader2, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { FieldHint, FormSheet } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveQuotaGroupAction, saveQuotaProfileAction, setQuotaRuleAction } from "@/modules/quotas/actions";

type Group = { id: string; code: string; name: string; isQuotaRelevant: boolean; sortOrder: number; active: boolean; articles: number };
type Rule = { quotaGroupId: string; validFromYear: number; validToYear: number | null; quantityPerYear: number; createdBy: string | null; createdAt: string };
type Profile = { id: string; code: string; name: string; entryRule: string | null; active: boolean; departments: string[]; rules: Rule[] };

const ENTRY_RULE_LABEL: Record<string, string> = { FULL: "voller Anspruch", PRORATED: "anteilig (monatsgenau)", MANUAL: "manuell" };

function effective(rules: Rule[], groupId: string, year: number) {
  return rules
    .filter((r) => r.quotaGroupId === groupId && r.validFromYear <= year && (r.validToYear === null || r.validToYear >= year))
    .sort((a, b) => b.validFromYear - a.validFromYear)[0];
}

export function QuotaAdminClient({
  canEdit,
  years,
  currentYear,
  globalEntryRule,
  groups,
  profiles,
}: {
  canEdit: boolean;
  years: number[];
  currentYear: number;
  globalEntryRule: string;
  groups: Group[];
  profiles: Profile[];
}) {
  const [groupEdit, setGroupEdit] = useState<Group | "new" | null>(null);
  const [profileEdit, setProfileEdit] = useState<Profile | "new" | null>(null);
  const [ruleEdit, setRuleEdit] = useState<{ profile: Profile; group: Group; year: number } | null>(null);
  const relevantGroups = groups.filter((g) => g.isQuotaRelevant && g.active);

  return (
    <div className="space-y-6">
      {profiles.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
              {!p.active && <StatusBadge tone="neutral">Inaktiv</StatusBadge>}
            </CardTitle>
            <CardDescription>
              Abteilungen: {p.departments.length ? p.departments.join(", ") : "keine"} · Eintrittsjahr:{" "}
              {p.entryRule ? ENTRY_RULE_LABEL[p.entryRule] : `${ENTRY_RULE_LABEL[globalEntryRule]} (Systemeinstellung)`}
            </CardDescription>
            {canEdit && (
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => setProfileEdit(p)}>
                  <Pencil className="size-4" /> Profil
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kontingentgruppe</TableHead>
                  {years.map((y) => (
                    <TableHead key={y} className={cn("text-right", y === currentYear && "text-foreground")}>
                      {y}
                      {y === currentYear && " (laufend)"}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {relevantGroups.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    {years.map((y) => {
                      const r = effective(p.rules, g.id, y);
                      const editable = canEdit && y >= currentYear;
                      return (
                        <TableCell key={y} className="text-right">
                          <button
                            type="button"
                            disabled={!editable}
                            onClick={() => setRuleEdit({ profile: p, group: g, year: y })}
                            className={cn(
                              "min-w-10 rounded px-2 py-0.5 tabular-nums",
                              editable && "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                              !r && "text-muted-foreground",
                            )}
                            title={r ? `gültig ab ${r.validFromYear}${r.createdBy ? `, angelegt von ${r.createdBy}` : ""}` : "keine Regel"}
                            aria-label={`${g.name} ${y}: ${r?.quantityPerYear ?? 0}${editable ? " – ändern" : ""}`}
                          >
                            {r?.quantityPerYear ?? "–"}
                          </button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {canEdit && <p className="mt-2 text-xs text-muted-foreground">Klick auf einen Wert im laufenden oder nächsten Jahr legt eine neue Regelversion ab diesem Jahr an.</p>}
          </CardContent>
        </Card>
      ))}
      {canEdit && (
        <Button variant="outline" onClick={() => setProfileEdit("new")}>
          <Plus className="size-4" /> Neues Kontingentprofil
        </Button>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Kontingentgruppen</CardTitle>
          <CardDescription>Worauf sich ein Anspruch bezieht (z. B. „T-Shirt“) – unabhängig vom konkreten Artikel.</CardDescription>
          {canEdit && (
            <CardAction>
              <Button size="sm" variant="outline" onClick={() => setGroupEdit("new")}>
                <Plus className="size-4" /> Gruppe
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Kontingent</TableHead>
                <TableHead className="text-right">Artikel</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead className="w-10"><span className="sr-only">Aktionen</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-mono text-xs">{g.code}</TableCell>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell>{g.isQuotaRelevant ? "kontingentpflichtig" : <StatusBadge tone="info" icon={null}>ohne Kontingent</StatusBadge>}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.articles}</TableCell>
                  <TableCell>{g.active ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Inaktiv</StatusBadge>}</TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button variant="ghost" size="icon" aria-label={`${g.name} bearbeiten`} onClick={() => setGroupEdit(g)}>
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {ruleEdit && <RuleDialog target={ruleEdit} onClose={() => setRuleEdit(null)} />}
      {groupEdit && <GroupSheet group={groupEdit === "new" ? null : groupEdit} onClose={() => setGroupEdit(null)} />}
      {profileEdit && <ProfileSheet profile={profileEdit === "new" ? null : profileEdit} onClose={() => setProfileEdit(null)} />}
    </div>
  );
}

function RuleDialog({ target, onClose }: { target: { profile: Profile; group: Group; year: number }; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const current = effective(target.profile.rules, target.group.id, target.year);
  const [qty, setQty] = useState(String(current?.quantityPerYear ?? 0));
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target.group.name} · {target.profile.name}
          </DialogTitle>
          <DialogDescription>
            Neuer Jahresanspruch ab {target.year}. Gilt auch für Folgejahre, bis eine spätere Regel greift. Frühere Jahre bleiben unverändert.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1">
            <Label htmlFor="rule-qty">Stück pro Jahr</Label>
            <Input id="rule-qty" type="number" min={0} max={100} value={qty} onChange={(e) => setQty(e.target.value)} className="w-32" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule-reason">Begründung (Pflicht)</Label>
            <Textarea id="rule-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            <FieldHint error={fieldErrors.reason} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            disabled={pending || qty === "" || reason.trim().length < 5}
            onClick={async () => {
              const res = await run(
                () => setQuotaRuleAction({ quotaProfileId: target.profile.id, quotaGroupId: target.group.id, validFromYear: target.year, quantityPerYear: Number(qty), reason }),
                { success: "Regel gespeichert." },
              );
              if (res.ok) onClose();
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupSheet({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const [v, setV] = useState({ code: group?.code ?? "", name: group?.name ?? "", isQuotaRelevant: group?.isQuotaRelevant ?? true, sortOrder: group?.sortOrder ?? 0, active: group?.active ?? true });
  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={group ? group.name : "Neue Kontingentgruppe"}
      pending={pending}
      onSubmit={async () => {
        const res = await run(() => saveQuotaGroupAction(group?.id ?? null, v), { success: "Gruppe gespeichert." });
        if (res.ok) onClose();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="g-code">Code</Label>
        <Input id="g-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        <FieldHint error={fieldErrors.code} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="g-name">Name</Label>
        <Input id="g-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <FieldHint error={fieldErrors.name} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="g-sort">Sortierung</Label>
        <Input id="g-sort" type="number" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: Number(e.target.value) || 0 })} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={v.isQuotaRelevant} onCheckedChange={(isQuotaRelevant) => setV({ ...v, isQuotaRelevant })} /> Kontingentpflichtig
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} /> Aktiv
      </label>
    </FormSheet>
  );
}

function ProfileSheet({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction();
  const [v, setV] = useState({ code: profile?.code ?? "", name: profile?.name ?? "", entryRule: (profile?.entryRule ?? null) as "FULL" | "PRORATED" | "MANUAL" | null, active: profile?.active ?? true });
  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={profile ? profile.name : "Neues Kontingentprofil"}
      description="Die Jahresansprüche pflegen Sie danach direkt in der Tabelle des Profils."
      pending={pending}
      onSubmit={async () => {
        const res = await run(() => saveQuotaProfileAction(profile?.id ?? null, v), { success: "Profil gespeichert." });
        if (res.ok) onClose();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="p-code">Code</Label>
        <Input id="p-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="z. B. PRODUKTION_STANDARD" />
        <FieldHint error={fieldErrors.code} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="p-name">Name</Label>
        <Input id="p-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <FieldHint error={fieldErrors.name} />
      </div>
      <div className="space-y-1">
        <Label>Eintritt im laufenden Jahr</Label>
        <Select value={v.entryRule ?? "__default"} onValueChange={(x) => setV({ ...v, entryRule: x === "__default" ? null : (x as "FULL" | "PRORATED" | "MANUAL") })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default">Systemeinstellung verwenden</SelectItem>
            <SelectItem value="FULL">Voller Jahresanspruch</SelectItem>
            <SelectItem value="PRORATED">Anteilig (Monate ab Eintrittsmonat / 12, gerundet, mind. 1)</SelectItem>
            <SelectItem value="MANUAL">Manuell (Anspruch 0, Vergabe per Anpassung)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} /> Aktiv
      </label>
    </FormSheet>
  );
}
