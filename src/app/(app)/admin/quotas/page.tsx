import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { currentYear } from "@/lib/dates";
import { getQuotaAdminData } from "@/modules/quotas/server/admin";
import { getSetting } from "@/modules/settings/server/settings";
import { can, requirePagePermission } from "@/server/actor";
import { QuotaAdminClient } from "./quota-admin-client";

export const metadata: Metadata = { title: "Kontingente" };

export default async function QuotaAdminPage() {
  const actor = await requirePagePermission("quota:adjust");
  const [{ groups, profiles }, entryRule] = await Promise.all([getQuotaAdminData(), getSetting("quota.entryRule")]);
  const year = currentYear();
  const years = [year - 1, year, year + 1];
  return (
    <>
      <PageHeader
        title="Kontingente"
        description="Jahresansprüche je Kontingentprofil, optional mit Mindestabstand zwischen zwei Ausgaben. Regeln sind versioniert: Änderungen gelten ab einem Jahr, vergangene Jahre bleiben unverändert."
      />
      <QuotaAdminClient
        canEdit={can(actor, "quota:manageProfiles")}
        years={years}
        currentYear={year}
        globalEntryRule={entryRule}
        groups={groups.map((g) => ({ id: g.id, code: g.code, name: g.name, isQuotaRelevant: g.isQuotaRelevant, sortOrder: g.sortOrder, active: g.active, articles: g._count.articles }))}
        profiles={profiles.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          entryRule: p.entryRule,
          active: p.active,
          departments: p.departments.map((d) => d.name),
          rules: p.rules.map((r) => ({
            quotaGroupId: r.quotaGroupId,
            validFromYear: r.validFromYear,
            validToYear: r.validToYear,
            quantityPerYear: r.quantityPerYear,
            minIntervalMonths: r.minIntervalMonths,
            createdBy: r.createdBy?.name ?? null,
            createdAt: r.createdAt.toISOString(),
          })),
        }))}
      />
    </>
  );
}
