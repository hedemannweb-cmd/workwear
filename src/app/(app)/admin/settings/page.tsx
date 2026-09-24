import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { getAllSettings } from "@/modules/settings/server/settings";
import { requirePagePermission } from "@/server/actor";
import { db } from "@/server/db";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  await requirePagePermission("settings:manage");
  const [settings, locations, scales] = await Promise.all([
    getAllSettings(),
    db.inventoryLocation.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.sizeScale.findMany({ orderBy: { sortOrder: "asc" }, include: { sizes: { orderBy: { sortOrder: "asc" } } } }),
  ]);
  return (
    <>
      <PageHeader title="Einstellungen" description="Systemweite Regeln. Jede Änderung wird mit Begründung im Audit Log protokolliert." />
      <SettingsClient settings={settings.map((s) => ({ key: s.key, label: s.label, value: s.value as never }))} />
      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="font-medium">Lagerorte</h2>
          <ul className="divide-y rounded-md border text-sm">
            {locations.map((l) => (
              <li key={l.id} className="flex justify-between px-3 py-2">
                <span>
                  {l.name} <span className="text-muted-foreground">({l.code})</span>
                </span>
                <span className="text-muted-foreground">{l.isDefault ? "Standard" : l.type === "DEFECTIVE" ? "Ausschuss" : "Lager"}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Mehrere Lagerorte sind im Datenmodell vorbereitet (Phase 3).</p>
        </section>
        <section className="space-y-2">
          <h2 className="font-medium">Größenskalen</h2>
          <ul className="divide-y rounded-md border text-sm">
            {scales.map((s) => (
              <li key={s.id} className="px-3 py-2">
                <span className="font-medium">{s.name}:</span> <span className="text-muted-foreground">{s.sizes.map((z) => z.value).join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
