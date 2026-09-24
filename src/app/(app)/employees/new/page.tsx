import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { toIsoDateInAppTz } from "@/lib/dates";
import { employeeFormOptions } from "@/modules/employees/server/employees";
import { requirePagePermission } from "@/server/actor";
import { EmployeeForm } from "../employee-form";

export const metadata: Metadata = { title: "Neuer Mitarbeiter" };

export default async function NewEmployeePage() {
  const actor = await requirePagePermission("employee:manage");
  const { departments } = await employeeFormOptions(actor);
  return (
    <>
      <PageHeader title="Neuer Mitarbeiter" description="Größen werden anschließend auf der Mitarbeiterseite erfasst." />
      <EmployeeForm
        id={null}
        departments={departments}
        defaults={{ employeeNumber: "", firstName: "", lastName: "", departmentId: "", entryDate: toIsoDateInAppTz(new Date()), exitDate: null, status: "ACTIVE", notes: null }}
      />
    </>
  );
}
