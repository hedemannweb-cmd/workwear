import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { listEmployees } from "@/modules/employees/server/employees";
import { can, requirePagePermission } from "@/server/actor";
import { EmployeeTable } from "./employee-table";

export const metadata: Metadata = { title: "Mitarbeiter" };

export default async function EmployeesPage() {
  const actor = await requirePagePermission("employee:view");
  const employees = await listEmployees(actor);
  return (
    <>
      <PageHeader
        title="Mitarbeiter"
        description={`${employees.filter((e) => e.status === "ACTIVE").length} aktiv · ${employees.length} gesamt${actor.departmentIds ? " (nur Ihre Abteilungen)" : ""}`}
        actions={
          can(actor, "employee:manage") && (
            <Button asChild>
              <Link href="/employees/new">
                <Plus className="size-4" /> Neuer Mitarbeiter
              </Link>
            </Button>
          )
        }
      />
      <EmployeeTable
        rows={employees.map((e) => ({
          id: e.id,
          employeeNumber: e.employeeNumber,
          name: `${e.lastName}, ${e.firstName}`,
          department: e.department.name,
          status: e.status,
          entryDate: e.entryDate.toISOString(),
          hasSizes: e._count.sizes > 0,
          openReservations: e._count.reservations,
        }))}
      />
    </>
  );
}
