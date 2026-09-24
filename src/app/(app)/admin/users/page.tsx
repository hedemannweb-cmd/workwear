import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { listUsers } from "@/modules/users/server/users";
import { requirePagePermission } from "@/server/actor";
import { db } from "@/server/db";
import { UsersClient } from "./users-client";

export const metadata: Metadata = { title: "Benutzer" };

export default async function UsersPage() {
  const actor = await requirePagePermission("user:manage");
  const [users, departments] = await Promise.all([
    listUsers(actor),
    db.department.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="Benutzer" description="Konten für Verantwortliche, Manager und Administratoren. Mitarbeiter selbst melden sich nicht an." />
      <UsersClient
        currentUserId={actor.userId}
        departments={departments}
        rows={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          restrictedToDepartments: u.restrictedToDepartments,
          departmentIds: u.departmentScopes.map((s) => s.departmentId),
          departments: u.departmentScopes.map((s) => s.department.name),
          lastSeen: u.sessions[0]?.updatedAt.toISOString() ?? null,
        }))}
      />
    </>
  );
}
