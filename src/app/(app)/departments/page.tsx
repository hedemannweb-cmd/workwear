import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { listDepartments } from "@/modules/departments/server/departments";
import { requirePagePermission } from "@/server/actor";
import { db } from "@/server/db";
import { DepartmentsClient } from "./departments-client";

export const metadata: Metadata = { title: "Abteilungen" };

export default async function DepartmentsPage() {
  await requirePagePermission("department:manage");
  const [departments, profiles] = await Promise.all([
    listDepartments(),
    db.quotaProfile.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="Abteilungen" description="Abteilungen werden Kontingentprofilen zugeordnet. Nicht mehr benötigte Abteilungen deaktivieren statt löschen." />
      <DepartmentsClient
        profiles={profiles}
        rows={departments.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          quotaProfileId: d.quotaProfileId,
          profile: d.quotaProfile ? `${d.quotaProfile.name} (${d.quotaProfile.code})` : null,
          costCenter: d.costCenter,
          active: d.active,
          employees: d._count.employees,
        }))}
      />
    </>
  );
}
