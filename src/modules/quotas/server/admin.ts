import "server-only";
import { z } from "zod";
import { EntryRule } from "@/generated/prisma/enums";
import { currentYear } from "@/lib/dates";
import { type Actor, assertCan } from "@/server/actor";
import { audit, diff } from "@/server/audit";
import { db } from "@/server/db";
import { DomainError, notFound } from "@/server/errors";
import { runInTransaction } from "@/server/tx";

export const quotaGroupSchema = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Z0-9_]+$/i, "Nur Buchstaben, Ziffern und _"),
  name: z.string().trim().min(2).max(60),
  isQuotaRelevant: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
});

export const quotaProfileSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_]+$/i, "Nur Buchstaben, Ziffern und _"),
  name: z.string().trim().min(2).max(80),
  entryRule: z.enum(EntryRule).nullable(),
  active: z.boolean(),
});

export const quotaRuleSchema = z.object({
  quotaProfileId: z.string().min(1),
  quotaGroupId: z.string().min(1),
  validFromYear: z.number().int().min(2000).max(2100),
  quantityPerYear: z.number().int().min(0).max(100),
  /** rollierender Mindestabstand zwischen zwei Ausgaben; null = keiner */
  minIntervalMonths: z.number().int().min(1, "Mindestens 1 Monat.").max(120, "Höchstens 120 Monate.").nullable().default(null),
});

export async function getQuotaAdminData() {
  const [groups, profiles] = await Promise.all([
    db.quotaGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { articles: true } } } }),
    db.quotaProfile.findMany({
      orderBy: { name: "asc" },
      include: {
        rules: { orderBy: [{ validFromYear: "desc" }], include: { createdBy: { select: { name: true } } } },
        departments: { select: { name: true } },
      },
    }),
  ]);
  return { groups, profiles };
}

export async function saveQuotaGroup(actor: Actor, id: string | null, raw: z.input<typeof quotaGroupSchema>) {
  assertCan(actor, "quota:manageProfiles");
  const input = quotaGroupSchema.parse(raw);
  await runInTransaction(async (tx) => {
    const data = { ...input, code: input.code.toUpperCase() };
    if (!id) {
      const g = await tx.quotaGroup.create({ data });
      await audit(tx, { actorId: actor.userId, action: "QUOTA_GROUP_CREATED", entityType: "QuotaGroup", entityId: g.id, newValue: data });
      return;
    }
    const before = await tx.quotaGroup.findUnique({ where: { id } });
    if (!before) throw notFound("Die Kontingentgruppe");
    await tx.quotaGroup.update({ where: { id }, data });
    const changes = diff(before, data);
    if (changes) await audit(tx, { actorId: actor.userId, action: "QUOTA_GROUP_UPDATED", entityType: "QuotaGroup", entityId: id, ...changes });
  });
}

export async function saveQuotaProfile(actor: Actor, id: string | null, raw: z.input<typeof quotaProfileSchema>) {
  assertCan(actor, "quota:manageProfiles");
  const input = quotaProfileSchema.parse(raw);
  await runInTransaction(async (tx) => {
    const data = { ...input, code: input.code.toUpperCase() };
    if (!id) {
      const p = await tx.quotaProfile.create({ data });
      await audit(tx, { actorId: actor.userId, action: "QUOTA_PROFILE_CREATED", entityType: "QuotaProfile", entityId: p.id, newValue: data });
      return;
    }
    const before = await tx.quotaProfile.findUnique({ where: { id } });
    if (!before) throw notFound("Das Kontingentprofil");
    await tx.quotaProfile.update({ where: { id }, data });
    const changes = diff(before, data);
    if (changes) await audit(tx, { actorId: actor.userId, action: "QUOTA_PROFILE_UPDATED", entityType: "QuotaProfile", entityId: id, ...changes });
  });
}

/**
 * Jahresanspruch ab einem Jahr festlegen (KONZEPT E10 / Vorgabe 10):
 * - Vergangene Jahre sind unveränderlich.
 * - Für das laufende oder ein künftiges Jahr wird eine neue Regelversion angelegt bzw. deren Menge geändert.
 * - Eine offene Vorgängerregel wird zum Vorjahr beendet (validToYear), damit Zeiträume eindeutig bleiben.
 */
export async function setQuotaRule(actor: Actor, raw: z.input<typeof quotaRuleSchema>) {
  assertCan(actor, "quota:manageProfiles");
  const input = quotaRuleSchema.parse(raw);
  const thisYear = currentYear();
  if (input.validFromYear < thisYear) {
    throw new DomainError("VALIDATION", `Kontingente vergangener Jahre (vor ${thisYear}) sind abgeschlossen und können nicht mehr geändert werden.`);
  }
  await runInTransaction(async (tx) => {
    const [profile, group] = await Promise.all([
      tx.quotaProfile.findUnique({ where: { id: input.quotaProfileId } }),
      tx.quotaGroup.findUnique({ where: { id: input.quotaGroupId } }),
    ]);
    if (!profile) throw notFound("Das Kontingentprofil");
    if (!group) throw notFound("Die Kontingentgruppe");

    const existing = await tx.quotaRule.findUnique({
      where: { quotaProfileId_quotaGroupId_validFromYear: { quotaProfileId: profile.id, quotaGroupId: group.id, validFromYear: input.validFromYear } },
    });
    const previous = await tx.quotaRule.findFirst({
      where: { quotaProfileId: profile.id, quotaGroupId: group.id, validFromYear: { lt: input.validFromYear } },
      orderBy: { validFromYear: "desc" },
    });
    const next = await tx.quotaRule.findFirst({
      where: { quotaProfileId: profile.id, quotaGroupId: group.id, validFromYear: { gt: input.validFromYear } },
      orderBy: { validFromYear: "asc" },
    });

    if (existing) {
      await tx.quotaRule.update({
        where: { id: existing.id },
        data: { quantityPerYear: input.quantityPerYear, minIntervalMonths: input.minIntervalMonths },
      });
    } else {
      await tx.quotaRule.create({
        data: {
          quotaProfileId: profile.id,
          quotaGroupId: group.id,
          validFromYear: input.validFromYear,
          validToYear: next ? next.validFromYear - 1 : null,
          quantityPerYear: input.quantityPerYear,
          minIntervalMonths: input.minIntervalMonths,
          createdById: actor.userId,
        },
      });
      if (previous && (previous.validToYear === null || previous.validToYear >= input.validFromYear)) {
        await tx.quotaRule.update({ where: { id: previous.id }, data: { validToYear: input.validFromYear - 1 } });
      }
    }

    await audit(tx, {
      actorId: actor.userId,
      action: "QUOTA_RULE_CHANGED",
      entityType: "QuotaProfile",
      entityId: profile.id,
      oldValue: {
        group: group.name,
        fromYear: input.validFromYear,
        quantityPerYear: (existing ?? previous)?.quantityPerYear ?? null,
        minIntervalMonths: (existing ?? previous)?.minIntervalMonths ?? null,
      },
      newValue: { group: group.name, fromYear: input.validFromYear, quantityPerYear: input.quantityPerYear, minIntervalMonths: input.minIntervalMonths },
    });
  });
}
