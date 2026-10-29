import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { requireAdminPage } from "@/server/actor";
import { CONFIGURABLE_ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, ROLE_LABELS } from "@/server/permissions";
import { getAllRolePermissions } from "@/server/role-permissions";
import { PermissionsClient } from "./permissions-client";

export const metadata: Metadata = { title: "Rollenrechte" };

export default async function PermissionsPage() {
  await requireAdminPage();
  const current = await getAllRolePermissions();
  return (
    <>
      <PageHeader
        title="Rollenrechte"
        description="Welche Funktionen Manager und Verantwortliche nutzen dürfen. Administratoren haben immer alle Rechte. Änderungen gelten sofort und werden im Audit Log protokolliert."
      />
      <PermissionsClient
        groups={PERMISSION_GROUPS}
        roles={CONFIGURABLE_ROLES.map((role) => ({
          role,
          label: ROLE_LABELS[role],
          permissions: current[role].permissions,
          defaults: [...DEFAULT_ROLE_PERMISSIONS[role]],
          isDefault: current[role].isDefault,
        }))}
      />
    </>
  );
}
