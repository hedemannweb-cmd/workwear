import "server-only";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { type Actor, assertCan } from "@/server/actor";
import { audit, diff } from "@/server/audit";
import { db } from "@/server/db";
import { DomainError, notFound } from "@/server/errors";
import { runInTransaction, type Tx } from "@/server/tx";

const password = z
  .string()
  .min(12, "Mindestens 12 Zeichen")
  .max(128)
  .refine((p) => /[a-zäöüß]/.test(p) && /[A-ZÄÖÜ]/.test(p) && /\d/.test(p), "Groß-, Kleinbuchstaben und Ziffern verwenden");

export const userSchema = z.object({
  name: z.string().trim().min(2, "Pflichtfeld").max(80),
  email: z.email("Ungültige E-Mail-Adresse").trim().toLowerCase(),
  role: z.enum(Role),
  active: z.boolean(),
  restrictedToDepartments: z.boolean(),
  departmentIds: z.array(z.string().min(1)).max(100),
});

export const createUserSchema = userSchema.extend({ password });

export async function listUsers(actor: Actor) {
  assertCan(actor, "user:manage");
  return db.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      restrictedToDepartments: true,
      createdAt: true,
      departmentScopes: { select: { departmentId: true, department: { select: { name: true } } } },
      sessions: { select: { updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });
}

/** Anlage durch einen Administrator (keine Selbstregistrierung). Passwort-Hash wie Better Auth (scrypt). */
export async function createUser(actor: Actor | null, raw: z.input<typeof createUserSchema>, client?: Tx) {
  if (actor) assertCan(actor, "user:manage");
  const input = createUserSchema.parse(raw);
  validateScope(input);
  const hash = await hashPassword(input.password);
  const work = async (tx: Tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        emailVerified: true,
        role: input.role,
        active: input.active,
        restrictedToDepartments: input.restrictedToDepartments,
        departmentScopes: input.restrictedToDepartments ? { create: input.departmentIds.map((departmentId) => ({ departmentId })) } : undefined,
      },
    });
    await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    await audit(tx, {
      actorId: actor?.userId ?? null,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      newValue: { name: input.name, email: input.email, role: input.role, restrictedToDepartments: input.restrictedToDepartments, departmentIds: input.departmentIds },
    });
    return user;
  };
  return client ? work(client) : runInTransaction(work);
}

export async function updateUser(actor: Actor, id: string, raw: z.input<typeof userSchema>) {
  assertCan(actor, "user:manage");
  const input = userSchema.parse(raw);
  validateScope(input);
  if (id === actor.userId && (!input.active || input.role !== "ADMIN")) {
    throw new DomainError("VALIDATION", "Sie können sich nicht selbst deaktivieren oder die Administratorrolle entziehen.");
  }
  await runInTransaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, include: { departmentScopes: true } });
    if (!before) throw notFound("Der Benutzer");
    await tx.user.update({
      where: { id },
      data: { name: input.name, email: input.email, role: input.role, active: input.active, restrictedToDepartments: input.restrictedToDepartments },
    });
    await tx.userDepartmentScope.deleteMany({ where: { userId: id } });
    if (input.restrictedToDepartments) {
      await tx.userDepartmentScope.createMany({ data: input.departmentIds.map((departmentId) => ({ userId: id, departmentId })) });
    }
    // Deaktivierung oder Rechteänderung: bestehende Sitzungen beenden
    if (!input.active || before.role !== input.role) await tx.session.deleteMany({ where: { userId: id } });
    const changes = diff(
      { ...before, departmentIds: before.departmentScopes.map((s) => s.departmentId).sort() },
      { name: input.name, email: input.email, role: input.role, active: input.active, restrictedToDepartments: input.restrictedToDepartments, departmentIds: [...input.departmentIds].sort() },
    );
    if (changes) await audit(tx, { actorId: actor.userId, action: "USER_UPDATED", entityType: "User", entityId: id, ...changes });
  });
}

export async function resetPassword(actor: Actor, id: string, newPassword: string) {
  assertCan(actor, "user:manage");
  const pw = password.parse(newPassword);
  const hash = await hashPassword(pw);
  await runInTransaction(async (tx) => {
    const account = await tx.account.findFirst({ where: { userId: id, providerId: "credential" } });
    if (account) await tx.account.update({ where: { id: account.id }, data: { password: hash } });
    else await tx.account.create({ data: { userId: id, accountId: id, providerId: "credential", password: hash } });
    await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, { actorId: actor.userId, action: "USER_PASSWORD_RESET", entityType: "User", entityId: id });
  });
}

function validateScope(input: { restrictedToDepartments: boolean; departmentIds: string[]; role: string }) {
  if (input.restrictedToDepartments && input.departmentIds.length === 0) {
    throw new DomainError("VALIDATION", "Bei eingeschränktem Zugriff mindestens eine Abteilung auswählen.");
  }
  if (input.restrictedToDepartments && input.role === "ADMIN") {
    throw new DomainError("VALIDATION", "Administratoren können nicht auf Abteilungen eingeschränkt werden.");
  }
}
