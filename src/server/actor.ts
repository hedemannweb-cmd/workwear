import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import type { Role } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { auth } from "./auth";
import { db } from "./db";
import { DomainError, forbidden } from "./errors";
import type { Permission } from "./permissions";
import { getRolePermissions } from "./role-permissions";

/** Der angemeldete Benutzer, wie ihn die Domänenfunktionen sehen. */
export type Actor = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  /** null = keine Einschränkung; sonst die erlaubten Abteilungen */
  departmentIds: string[] | null;
  /** Wirksame Rechte der Rolle (ADMIN: alle; sonst Konfiguration aus /admin/permissions). */
  permissions: ReadonlySet<Permission>;
};

/** Lädt den Actor frisch aus der Datenbank (Rolle/Aktivstatus nie aus dem Cookie übernehmen). */
export async function loadActor(userId: string): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      restrictedToDepartments: true,
      departmentScopes: { select: { departmentId: true } },
    },
  });
  if (!user || !user.active) return null;
  const permissions = await getRolePermissions(user.role);
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentIds: user.restrictedToDepartments ? user.departmentScopes.map((s) => s.departmentId) : null,
    permissions,
  };
}

/** Actor der aktuellen Anfrage, pro Request gecacht. */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return loadActor(session.user.id);
});

export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Bitte melden Sie sich an.");
  return actor;
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.role === "ADMIN" || actor.permissions.has(permission);
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw forbidden();
}

/** Prisma-Filter, der Mitarbeiterabfragen auf den Abteilungs-Scope des Actors einschränkt. */
export function employeeScopeWhere(actor: Actor): Prisma.EmployeeWhereInput {
  return actor.departmentIds === null ? {} : { departmentId: { in: actor.departmentIds } };
}

export function isDepartmentInScope(actor: Actor, departmentId: string): boolean {
  return actor.departmentIds === null || actor.departmentIds.includes(departmentId);
}

/**
 * Prüft, ob der Actor den Mitarbeiter bearbeiten darf. Wirft NOT_FOUND statt FORBIDDEN,
 * damit die Existenz fremder Mitarbeiter nicht offengelegt wird (BDR-11).
 */
export function assertEmployeeInScope(actor: Actor, employee: { departmentId: string }): void {
  if (!isDepartmentInScope(actor, employee.departmentId)) {
    throw new DomainError("NOT_FOUND", "Der Mitarbeiter wurde nicht gefunden.");
  }
}

/**
 * Für Seiten: fehlende Berechtigung führt auf eine verständliche Hinweisseite statt zu einem Fehler.
 * (Server Actions und Domänenfunktionen prüfen unabhängig davon selbst.)
 */
export async function requirePagePermission(permission: Permission): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor, permission)) {
    const { redirect } = await import("next/navigation");
    redirect("/kein-zugriff");
  }
  return actor;
}

/** Für Seiten, die bewusst nur der Rolle Administrator offenstehen (nicht über Rollenrechte delegierbar). */
export async function requireAdminPage(): Promise<Actor> {
  const actor = await requireActor();
  if (actor.role !== "ADMIN") {
    const { redirect } = await import("next/navigation");
    redirect("/kein-zugriff");
  }
  return actor;
}
