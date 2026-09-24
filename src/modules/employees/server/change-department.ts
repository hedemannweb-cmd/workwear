import "server-only";
import { z } from "zod";
import { dateOnly, isoFromDateOnly, todayDateOnly } from "@/lib/dates";
import { type Actor, assertCan, assertEmployeeInScope } from "@/server/actor";
import { audit } from "@/server/audit";
import { DomainError, notFound } from "@/server/errors";
import { runInTransaction } from "@/server/tx";

export const changeDepartmentSchema = z.object({
  employeeId: z.string().min(1),
  departmentId: z.string().min(1),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum"),
  reason: z.string().trim().min(5, "Bitte eine Begründung (mind. 5 Zeichen) angeben.").max(500),
});

/**
 * Abteilungswechsel (KONZEPT.md E.3, BDR-3). Historisiert in EmployeeDepartmentHistory;
 * vergangene Ausgaben bleiben unverändert (departmentIdSnapshot an der Ausgabe).
 * Das Kontingent richtet sich danach nach der Abteilung am Stichtag.
 */
export async function changeDepartment(actor: Actor, rawInput: z.input<typeof changeDepartmentSchema>) {
  assertCan(actor, "employee:changeDepartment");
  const input = changeDepartmentSchema.parse(rawInput);
  const validFrom = dateOnly(input.validFrom);

  await runInTransaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Employee" WHERE "id" = ${input.employeeId} FOR UPDATE`;
    const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, include: { department: true } });
    if (!employee) throw notFound("Der Mitarbeiter");
    assertEmployeeInScope(actor, employee);
    if (employee.departmentId === input.departmentId) throw new DomainError("VALIDATION", "Der Mitarbeiter ist bereits in dieser Abteilung.");
    const target = await tx.department.findUnique({ where: { id: input.departmentId } });
    if (!target || !target.active) throw notFound("Die Abteilung");

    const current = await tx.employeeDepartmentHistory.findFirst({
      where: { employeeId: employee.id, validTo: null },
      orderBy: { validFrom: "desc" },
    });
    if (current && validFrom <= current.validFrom) {
      throw new DomainError(
        "VALIDATION",
        `Der Wechsel muss nach dem Beginn der aktuellen Zuordnung (${isoFromDateOnly(current.validFrom).split("-").reverse().join(".")}) liegen.`,
      );
    }
    if (validFrom > todayDateOnly()) {
      throw new DomainError("VALIDATION", "Ein Abteilungswechsel kann nicht in der Zukunft gebucht werden.");
    }
    if (validFrom < employee.entryDate) throw new DomainError("VALIDATION", "Der Wechsel darf nicht vor dem Eintrittsdatum liegen.");

    if (current) await tx.employeeDepartmentHistory.update({ where: { id: current.id }, data: { validTo: validFrom } });
    await tx.employeeDepartmentHistory.create({
      data: { employeeId: employee.id, departmentId: target.id, validFrom, changedById: actor.userId, reason: input.reason },
    });
    await tx.employee.update({ where: { id: employee.id }, data: { departmentId: target.id } });

    await audit(tx, {
      actorId: actor.userId,
      action: "EMPLOYEE_DEPARTMENT_CHANGED",
      entityType: "Employee",
      entityId: employee.id,
      oldValue: { department: employee.department.name },
      newValue: { department: target.name, validFrom: input.validFrom },
      reason: input.reason,
    });
  });
}
