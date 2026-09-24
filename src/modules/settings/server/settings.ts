import "server-only";
import { z } from "zod";
import { EntryRule } from "@/generated/prisma/enums";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/actor";
import { assertCan } from "@/server/actor";
import { db } from "@/server/db";
import { runInTransaction, type Tx } from "@/server/tx";

/**
 * Typisierte Systemeinstellungen (Tabelle AppSetting). Jede Einstellung hat ein Schema und
 * einen Standardwert; ungültige gespeicherte Werte fallen auf den Standard zurück.
 */
const SETTINGS = {
  "quota.entryRule": { schema: z.enum(EntryRule), default: "PRORATED" as EntryRule, label: "Kontingent im Eintrittsjahr" },
  "privacy.retentionYears": { schema: z.number().int().min(1).max(30), default: 1, label: "Aufbewahrung ausgeschiedener Mitarbeiter (Jahre)" },
  "issue.responsibleCancelSameDayOnly": { schema: z.boolean(), default: true, label: "Verantwortliche dürfen nur eigene Ausgaben am selben Tag stornieren" },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export async function getSetting<K extends SettingKey>(key: K, client: Tx | typeof db = db): Promise<SettingValue<K>> {
  const row = await client.appSetting.findUnique({ where: { key } });
  const def = SETTINGS[key];
  if (!row) return def.default as SettingValue<K>;
  const parsed = def.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : def.default) as SettingValue<K>;
}

export async function getAllSettings() {
  const rows = await db.appSetting.findMany();
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const row = rows.find((r) => r.key === key);
    const parsed = row ? SETTINGS[key].schema.safeParse(row.value) : null;
    return { key, label: SETTINGS[key].label, value: parsed?.success ? parsed.data : SETTINGS[key].default, isDefault: !parsed?.success };
  });
}

export async function updateSetting<K extends SettingKey>(actor: Actor, key: K, value: unknown, reason: string) {
  assertCan(actor, "settings:manage");
  const parsed = SETTINGS[key].schema.parse(value);
  await runInTransaction(async (tx) => {
    const before = await getSetting(key, tx);
    await tx.appSetting.upsert({
      where: { key },
      create: { key, value: parsed as never, updatedById: actor.userId },
      update: { value: parsed as never, updatedById: actor.userId },
    });
    await audit(tx, { actorId: actor.userId, action: "SETTING_CHANGED", entityType: "AppSetting", entityId: key, oldValue: before, newValue: parsed, reason });
  });
}
