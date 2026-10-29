"use client";

import { useState } from "react";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateSettingAction } from "@/modules/settings/actions";
import type { SettingKey } from "@/modules/settings/server/settings";

type Setting = { key: SettingKey; label: string; value: string | number | boolean | string[] };

const DESCRIPTIONS: Record<SettingKey, string> = {
  "quota.entryRule":
    "Anspruch im Eintrittsjahr. Anteilig: Monate ab Eintrittsmonat (voll gezählt) / 12 × Jahresanspruch, kaufmännisch gerundet, mindestens 1. Profile können abweichen.",
  "privacy.retentionYears": "Nach Ablauf dieser Frist nach dem Austritt können Mitarbeiterdaten pseudonymisiert werden. Buchungen bleiben erhalten.",
  "issue.responsibleCancelSameDayOnly": "Verantwortliche dürfen eigene Ausgaben nur am selben Tag stornieren. Manager und Administratoren jederzeit.",
  "notifications.lowStockRecipients":
    "Diese Adressen bekommen eine Mail, sobald der frei verfügbare Bestand einer Variante den Mindestbestand erreicht oder unterschreitet. Eine Adresse pro Zeile. Erneute Mail erst, wenn der Bestand zwischenzeitlich wieder darüber lag.",
  "notifications.lowStockNotifyManagers": "Zusätzlich zu den eingetragenen Adressen erhalten alle aktiven Benutzer mit der Rolle Manager die Mindestbestands-Mail.",
};

const parseEmails = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((m) => m.trim())
    .filter(Boolean);

export function SettingsClient({ settings }: { settings: Setting[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {settings.map((s) => (
        <SettingCard key={s.key} setting={s} />
      ))}
    </div>
  );
}

function SettingCard({ setting }: { setting: Setting }) {
  const { run, pending } = useAction();
  const [value, setValue] = useState(setting.value);
  const [reason, setReason] = useState("");
  const changed = Array.isArray(value) ? JSON.stringify(value) !== JSON.stringify(setting.value) : value !== setting.value;
  const [emailText, setEmailText] = useState(Array.isArray(setting.value) ? setting.value.join("\n") : "");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{setting.label}</CardTitle>
        <CardDescription>{DESCRIPTIONS[setting.key]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {setting.key === "quota.entryRule" ? (
          <Select value={String(value)} onValueChange={setValue}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FULL">Voller Jahresanspruch</SelectItem>
              <SelectItem value="PRORATED">Anteilig</SelectItem>
              <SelectItem value="MANUAL">Manuell</SelectItem>
            </SelectContent>
          </Select>
        ) : Array.isArray(setting.value) ? (
          <Textarea
            rows={4}
            value={emailText}
            placeholder="lager@example.com"
            onChange={(e) => {
              setEmailText(e.target.value);
              setValue(parseEmails(e.target.value));
            }}
          />
        ) : typeof setting.value === "boolean" ? (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={value === true} onCheckedChange={setValue} /> {value ? "Ja" : "Nein"}
          </label>
        ) : (
          <Input type="number" min={1} max={30} value={String(value)} onChange={(e) => setValue(Number(e.target.value))} className="w-24" />
        )}
        {changed && (
          <div className="space-y-2">
            <Label htmlFor={`r-${setting.key}`}>Begründung</Label>
            <Input id={`r-${setting.key}`} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" disabled={pending || reason.trim().length < 5} onClick={() => run(() => updateSettingAction(setting.key, value, reason), { success: "Einstellung gespeichert." })}>
              Speichern
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
