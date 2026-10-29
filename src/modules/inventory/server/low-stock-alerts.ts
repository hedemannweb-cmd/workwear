import "server-only";
import { getSetting } from "@/modules/settings/server/settings";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { type MailSender, mailConfigured, sendMail } from "@/server/mail";

/**
 * Mail-Benachrichtigung, wenn der freie Bestand einer Variante (Summe über aktive Lagerorte vom Typ STORAGE)
 * den Mindestbestand erreicht oder unterschreitet.
 *
 * Je Unterschreitung genau eine Mail: Vor dem Versand wird die Variante in LowStockAlert eingetragen
 * (ON CONFLICT DO NOTHING – parallele Läufe melden dieselbe Variante nicht doppelt). Liegt der freie
 * Bestand wieder über dem Mindestbestand, wird der Eintrag gelöscht; die nächste Unterschreitung
 * wird dann erneut gemeldet.
 */
type LowVariant = {
  id: string;
  variantSku: string;
  articleName: string;
  size: string | null;
  color: string | null;
  free: number;
  minStock: number;
};

export async function checkLowStockAlerts(options: { send?: MailSender; configured?: boolean } = {}): Promise<{ notified: string[] }> {
  const rows = await db.$queryRaw<Array<LowVariant & { low: boolean }>>`
    SELECT v."id", v."variantSku", a."name" AS "articleName", s."value" AS size, v."color",
           COALESCE(SUM(i."physicalQuantity" - i."reservedQuantity"), 0)::int AS free,
           v."minStock"::int AS "minStock",
           (v."active" AND a."active" AND a."isStockItem" AND v."minStock" IS NOT NULL
             AND COALESCE(SUM(i."physicalQuantity" - i."reservedQuantity"), 0) <= v."minStock") AS low
      FROM "ArticleVariant" v
      JOIN "Article" a ON a."id" = v."articleId"
      LEFT JOIN "Size" s ON s."id" = v."sizeId"
      LEFT JOIN "Inventory" i ON i."articleVariantId" = v."id"
           AND i."inventoryLocationId" IN (SELECT "id" FROM "InventoryLocation" WHERE "type" = 'STORAGE' AND "active")
     WHERE (v."minStock" IS NOT NULL OR v."id" IN (SELECT "articleVariantId" FROM "LowStockAlert"))
     GROUP BY v."id", a."id", s."value", s."sortOrder"
     ORDER BY a."name", s."sortOrder", v."color"`;

  // Wieder aufgefüllt (oder Mindestbestand entfernt/Variante deaktiviert): Meldung zurücksetzen
  const recovered = rows.filter((r) => !r.low).map((r) => r.id);
  if (recovered.length > 0)
    await db.lowStockAlert.deleteMany({
      where: { articleVariantId: { in: recovered } },
    });

  const low = rows.filter((r) => r.low);
  if (low.length === 0) return { notified: [] };

  const recipients = await lowStockRecipients();
  // Ohne Empfänger oder SMTP nichts als gemeldet markieren – sobald beides eingerichtet ist, wird nachgeholt
  if (recipients.length === 0 || !(options.configured ?? mailConfigured())) return { notified: [] };

  const claimed = new Set<string>();
  for (const v of low) {
    const n = await db.$executeRaw`
      INSERT INTO "LowStockAlert" ("articleVariantId", "free", "minStock", "notifiedAt")
      VALUES (${v.id}, ${v.free}, ${v.minStock}, now())
      ON CONFLICT ("articleVariantId") DO NOTHING`;
    if (n > 0) claimed.add(v.id);
  }
  const fresh = low.filter((v) => claimed.has(v.id));
  if (fresh.length === 0) return { notified: [] };

  try {
    await (options.send ?? sendMail)({
      to: recipients,
      ...lowStockMail(fresh),
    });
    logger.info("low stock mail sent", {
      variants: fresh.length,
      recipients: recipients.length,
    });
    return { notified: fresh.map((v) => v.id) };
  } catch (error) {
    // Versand fehlgeschlagen: Markierung zurücknehmen, damit der nächste Lauf es erneut versucht
    await db.lowStockAlert.deleteMany({
      where: { articleVariantId: { in: [...claimed] } },
    });
    logger.error("low stock mail failed", { error });
    return { notified: [] };
  }
}

async function lowStockRecipients(): Promise<string[]> {
  const [configured, notifyManagers] = await Promise.all([getSetting("notifications.lowStockRecipients"), getSetting("notifications.lowStockNotifyManagers")]);
  const managers = notifyManagers
    ? (
        await db.user.findMany({
          where: { role: "MANAGER", active: true },
          select: { email: true },
        })
      ).map((u) => u.email)
    : [];
  return [...new Map([...configured, ...managers].map((m) => [m.trim().toLowerCase(), m.trim()])).values()];
}

export function lowStockMail(variants: LowVariant[]): {
  subject: string;
  text: string;
} {
  const label = (v: LowVariant) => [v.articleName, v.size && `Größe ${v.size}`, v.color].filter(Boolean).join(", ");
  const subject = variants.length === 1 ? `Mindestbestand erreicht: ${label(variants[0])}` : `Mindestbestand erreicht: ${variants.length} Artikelvarianten`;
  const lines = variants.map((v) => `- ${label(v)} (${v.variantSku}): ${v.free} frei verfügbar, Mindestbestand ${v.minStock}`);
  const text = [
    "Guten Tag,",
    "",
    variants.length === 1
      ? "bei folgender Artikelvariante ist der Mindestbestand erreicht oder unterschritten:"
      : "bei folgenden Artikelvarianten ist der Mindestbestand erreicht oder unterschritten:",
    "",
    ...lines,
    "",
    "Diese Nachricht wurde automatisch von der Arbeitskleidungsverwaltung versendet. Eine weitere Mail zu",
    "derselben Variante folgt erst, wenn der Bestand zwischenzeitlich wieder über dem Mindestbestand lag.",
  ].join("\n");
  return { subject, text };
}

let running: Promise<unknown> | undefined;
let rerun = false;

/** Prüfung im Hintergrund anstoßen; gleichzeitige Anstöße werden zu einem weiteren Lauf zusammengefasst. */
export function triggerLowStockCheck(): void {
  if (running) {
    rerun = true;
    return;
  }
  running = checkLowStockAlerts()
    .catch((error) => logger.error("low stock check failed", { error }))
    .finally(() => {
      running = undefined;
      if (rerun) {
        rerun = false;
        triggerLowStockCheck();
      }
    });
}
