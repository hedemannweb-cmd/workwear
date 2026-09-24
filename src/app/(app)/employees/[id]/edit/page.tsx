import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { isoFromDateOnly } from "@/lib/dates";
import { employeeFormOptions, getEmployee } from "@/modules/employees/server/employees";
import { requirePagePermission } from "@/server/actor";
import { isDomainError } from "@/server/errors";
import { db } from "@/server/db";
import { EmployeeForm } from "../../employee-form";

export const metadata: Metadata = { title: "Mitarbeiter bearbeiten" };

export default async function EditEmployeePage(props: PageProps<"/employees/[id]/edit">) {
  const actor = await requirePagePermission("employee:manage");
  const { id } = await props.params;
  const employee = await getEmployee(actor, id).catch((e) => {
    if (isDomainError(e)) notFound();
    throw e;
  });
  const { departments } = await employeeFormOptions(actor);
  // aktuelle Abteilung auch anzeigen, wenn sie inzwischen inaktiv ist
  if (!departments.some((d) => d.id === employee.departmentId)) {
    const d = await db.department.findUniqueOrThrow({ where: { id: employee.departmentId }, select: { id: true, name: true } });
    departments.push(d);
  }
  return (
    <>
      <PageHeader title={`${employee.firstName} ${employee.lastName} bearbeiten`} />
      <EmployeeForm
        id={employee.id}
        departments={departments}
        defaults={{
          employeeNumber: employee.employeeNumber,
          firstName: employee.firstName,
          lastName: employee.lastName,
          departmentId: employee.departmentId,
          entryDate: isoFromDateOnly(employee.entryDate),
          exitDate: employee.exitDate ? isoFromDateOnly(employee.exitDate) : null,
          status: employee.status,
          notes: employee.notes,
        }}
      />
    </>
  );
}
