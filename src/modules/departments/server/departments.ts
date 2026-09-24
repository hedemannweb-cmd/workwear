import "server-only";
import { z } from "zod";
import { type Actor, assertCan } from "@/server/actor";
import { audit, diff } from "@/server/audit";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { runInTransaction } from "@/server/tx";

export const departmentSchema = z.object({
  code: z.string().trim().min(2, "Mindestens 2 Zeichen").max(20).regex(/^[A-Z0-9_-]+$/i, "Nur Buchstaben, Ziffern, - und _"),
  name: z.string().trim().min(2, "Mindestens 2 Zeichen").max(80),
  quotaProfileId: z.string().min(1).nullable(),
  costCenter: z.string().trim().max(40).nullable(),
  active: z.boolean(),
});

export async function listDepartments() {
  return db.department.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { quotaProfile: { select: { id: true, code: true, name: true } }, _count: { select: { employees: { where: { status: "ACTIVE" } } } } },
  });
}

export async function createDepartment(actor: Actor, raw: z.input<typeof departmentSchema>) {
  assertCan(actor, "department:manage");
  const input = departmentSchema.parse(raw);
  return runInTransaction(async (tx) => {
    const d = await tx.department.create({ data: { ...input, code: input.code.toUpperCase() } });
    await audit(tx, { actorId: actor.userId, action: "DEPARTMENT_CREATED", entityType: "Department", entityId: d.id, newValue: input });
    return d;
  });
}

export async function updateDepartment(actor: Actor, id: string, raw: z.input<typeof departmentSchema>) {
  assertCan(actor, "department:manage");
  const input = departmentSchema.parse(raw);
  return runInTransaction(async (tx) => {
    const before = await tx.department.findUnique({ where: { id } });
    if (!before) throw notFound("Die Abteilung");
    const data = { ...input, code: input.code.toUpperCase() };
    await tx.department.update({ where: { id }, data });
    const changes = diff(before, data);
    if (changes) await audit(tx, { actorId: actor.userId, action: "DEPARTMENT_UPDATED", entityType: "Department", entityId: id, ...changes });
  });
}
