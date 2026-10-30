import "server-only";
import { z } from "zod";
import { dateOnly, isoFromDateOnly } from "@/lib/dates";
import { type Actor, assertCan, assertEmployeeInScope, employeeScopeWhere, isDepartmentInScope } from "@/server/actor";
import { audit, diff } from "@/server/audit";
import { db } from "@/server/db";
import { DomainError, forbidden, notFound } from "@/server/errors";
import { runInTransaction, type Tx } from "@/server/tx";

import { employeeSchema, type EmployeeInput } from "../schemas";

export { employeeSchema, type EmployeeInput };

export async function listEmployees(actor: Actor) {
  assertCan(actor, "employee:view");
  return db.employee.findMany({
    where: employeeScopeWhere(actor),
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      status: true,
      entryDate: true,
      exitDate: true,
      department: { select: { id: true, name: true } },
      _count: { select: { sizes: true, reservations: { where: { status: { in: ["PENDING", "ORDERED", "RECEIVED"] } } } } },
    },
  });
}

export async function getEmployee(actor: Actor, id: string) {
  assertCan(actor, "employee:view");
  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      department: { include: { quotaProfile: { select: { code: true, name: true } } } },
      sizes: { include: { size: true, sizeScale: true, category: true } },
      departmentHistory: { include: { department: true, changedBy: { select: { name: true } } }, orderBy: { validFrom: "desc" } },
    },
  });
  if (!employee) throw notFound("Der Mitarbeiter");
  assertEmployeeInScope(actor, employee);
  return employee;
}

export async function createEmployee(actor: Actor, raw: EmployeeInput) {
  assertCan(actor, "employee:manage");
  const input = employeeSchema.parse(raw);
  if (!isDepartmentInScope(actor, input.departmentId)) throw forbidden();
  return runInTransaction(async (tx) => {
    const dept = await tx.department.findUnique({ where: { id: input.departmentId } });
    if (!dept?.active) throw new DomainError("VALIDATION", "Die Abteilung ist nicht aktiv.");
    return insertEmployee(tx, actor.userId, input, "Anlage");
  });
}

/** Legt einen bereits geprüften Mitarbeiter samt Abteilungshistorie und Audit-Eintrag an (auch für den Excel-Import). */
export async function insertEmployee(tx: Tx, actorId: string, input: z.output<typeof employeeSchema>, reason: string) {
  const entryDate = dateOnly(input.entryDate);
  const employee = await tx.employee.create({
    data: {
      ...input,
      entryDate,
      exitDate: input.exitDate ? dateOnly(input.exitDate) : null,
      departmentHistory: { create: { departmentId: input.departmentId, validFrom: entryDate, changedById: actorId, reason } },
    },
  });
  const newValue = reason === "Anlage" ? redactPersonal(input) : { ...redactPersonal(input), source: reason };
  await audit(tx, { actorId, action: "EMPLOYEE_CREATED", entityType: "Employee", entityId: employee.id, newValue });
  return employee;
}

/**
 * Stammdaten ändern. Die Abteilung wird hier bewusst NICHT geändert – das ist ein eigener,
 * historisierter Prozess (changeDepartment).
 */
export async function updateEmployee(actor: Actor, id: string, raw: EmployeeInput) {
  assertCan(actor, "employee:manage");
  const input = employeeSchema.parse(raw);
  return runInTransaction(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id } });
    if (!before) throw notFound("Der Mitarbeiter");
    assertEmployeeInScope(actor, before);
    if (before.departmentId !== input.departmentId) {
      throw new DomainError("VALIDATION", "Die Abteilung wird über „Abteilung wechseln“ geändert (mit Historie).");
    }
    const entryDate = dateOnly(input.entryDate);
    if (entryDate.getTime() !== before.entryDate.getTime()) {
      const firstHistory = await tx.employeeDepartmentHistory.findFirst({ where: { employeeId: id }, orderBy: { validFrom: "asc" } });
      const laterChange = await tx.employeeDepartmentHistory.count({ where: { employeeId: id, validFrom: { lte: entryDate }, id: { not: firstHistory?.id } } });
      if (laterChange > 0) throw new DomainError("VALIDATION", "Das Eintrittsdatum darf nicht nach einem Abteilungswechsel liegen.");
      if (firstHistory) await tx.employeeDepartmentHistory.update({ where: { id: firstHistory.id }, data: { validFrom: entryDate } });
    }
    const data = {
      employeeNumber: input.employeeNumber,
      firstName: input.firstName,
      lastName: input.lastName,
      entryDate,
      exitDate: input.exitDate ? dateOnly(input.exitDate) : null,
      status: input.status,
      notes: input.notes,
    };
    await tx.employee.update({ where: { id }, data });
    const changes = diff(
      { ...before, entryDate: isoFromDateOnly(before.entryDate), exitDate: before.exitDate ? isoFromDateOnly(before.exitDate) : null },
      { ...data, entryDate: input.entryDate, exitDate: input.exitDate },
    );
    if (changes) {
      await audit(tx, {
        actorId: actor.userId,
        action: "EMPLOYEE_UPDATED",
        entityType: "Employee",
        entityId: id,
        oldValue: redactPersonal(changes.oldValue),
        newValue: redactPersonal(changes.newValue),
      });
    }
  });
}

/**
 * Namen und Notizen nicht im (unveränderlichen) Audit Log speichern, damit die Pseudonymisierung
 * nach Ablauf der Aufbewahrungsfrist vollständig wirkt. Protokolliert wird, DASS sich das Feld geändert hat.
 */
function redactPersonal<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = { ...value };
  for (const key of ["firstName", "lastName", "notes"]) if (key in out) out[key] = "[personenbezogen – nicht protokolliert]";
  return out as T;
}

export const employeeSizesSchema = z.object({
  sizes: z
    .array(z.object({ sizeScaleId: z.string().min(1), categoryId: z.string().min(1).nullable(), sizeId: z.string().min(1).nullable() }))
    .max(50),
});

/** Größen je Skala (Standard) und optional je Kategorie überschreiben. sizeId null = entfernen. */
export async function setEmployeeSizes(actor: Actor, employeeId: string, raw: z.input<typeof employeeSizesSchema>) {
  assertCan(actor, "employee:editSizes");
  const input = employeeSizesSchema.parse(raw);
  await runInTransaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw notFound("Der Mitarbeiter");
    assertEmployeeInScope(actor, employee);
    const before = await tx.employeeSize.findMany({ where: { employeeId }, include: { size: true } });

    for (const s of input.sizes) {
      const existing = before.find((b) => b.sizeScaleId === s.sizeScaleId && b.categoryId === s.categoryId);
      if (!s.sizeId) {
        if (existing) await tx.employeeSize.delete({ where: { id: existing.id } });
        continue;
      }
      const size = await tx.size.findUnique({ where: { id: s.sizeId } });
      if (!size || size.sizeScaleId !== s.sizeScaleId) throw new DomainError("VALIDATION", "Ungültige Größe.");
      if (existing) await tx.employeeSize.update({ where: { id: existing.id }, data: { sizeId: s.sizeId } });
      else await tx.employeeSize.create({ data: { employeeId, sizeScaleId: s.sizeScaleId, categoryId: s.categoryId, sizeId: s.sizeId } });
    }
    const after = await tx.employeeSize.findMany({ where: { employeeId }, include: { size: true } });
    const fmt = (list: typeof after) => list.map((x) => `${x.sizeScaleId}/${x.categoryId ?? "-"}=${x.size.value}`).sort();
    await audit(tx, {
      actorId: actor.userId,
      action: "EMPLOYEE_SIZES_UPDATED",
      entityType: "Employee",
      entityId: employeeId,
      oldValue: fmt(before),
      newValue: fmt(after),
    });
  });
}

/** Stammdaten für Formulare: Abteilungen im Scope, Größenskalen mit Größen, Kategorien. */
export async function employeeFormOptions(actor: Actor) {
  const [departments, scales, categories] = await Promise.all([
    db.department.findMany({
      where: { active: true, ...(actor.departmentIds ? { id: { in: actor.departmentIds } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.sizeScale.findMany({ orderBy: { sortOrder: "asc" }, include: { sizes: { orderBy: { sortOrder: "asc" } } } }),
    db.clothingCategory.findMany({ where: { active: true, sizeScaleId: { not: null } }, orderBy: { sortOrder: "asc" } }),
  ]);
  return { departments, scales, categories };
}

/**
 * Pseudonymisierung ausgeschiedener Mitarbeiter nach Ablauf der Aufbewahrungsfrist (BDR-13: 1 Jahr).
 * Name und Notizen werden ersetzt, Buchungen bleiben für Auswertungen erhalten.
 */
export async function pseudonymizeEmployee(actor: Actor, employeeId: string, retentionYears: number) {
  assertCan(actor, "employee:manage");
  await runInTransaction(async (tx) => {
    const e = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!e) throw notFound("Der Mitarbeiter");
    if (e.status !== "LEFT" || !e.exitDate) throw new DomainError("VALIDATION", "Nur ausgeschiedene Mitarbeiter können pseudonymisiert werden.");
    const limit = new Date(e.exitDate);
    limit.setUTCFullYear(limit.getUTCFullYear() + retentionYears);
    if (limit > new Date()) {
      throw new DomainError("VALIDATION", `Die Aufbewahrungsfrist (${retentionYears} Jahr(e) nach Austritt) ist noch nicht abgelaufen.`);
    }
    if (e.pseudonymizedAt) throw new DomainError("VALIDATION", "Der Mitarbeiter ist bereits pseudonymisiert.");
    await tx.employee.update({
      where: { id: employeeId },
      data: { firstName: "Ehemalige/r", lastName: `#${e.employeeNumber}`, notes: null, pseudonymizedAt: new Date() },
    });
    await tx.employeeSize.deleteMany({ where: { employeeId } });
    await audit(tx, {
      actorId: actor.userId,
      action: "EMPLOYEE_PSEUDONYMIZED",
      entityType: "Employee",
      entityId: employeeId,
      newValue: { employeeNumber: e.employeeNumber },
    });
  });
}
