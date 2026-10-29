"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import type { ConfigurableRole, Permission } from "@/server/permissions";
import { updateRolePermissions } from "./server/role-permissions";
import { updateSetting, type SettingKey } from "./server/settings";

export async function updateSettingAction(key: SettingKey, value: unknown, reason?: string) {
  return runAction("updateSetting", async () => {
    await updateSetting(await requireActor(), key, value, reason);
    revalidatePath("/admin/settings");
  });
}

export async function updateRolePermissionsAction(role: ConfigurableRole, permissions: Permission[]) {
  return runAction("updateRolePermissions", async () => {
    await updateRolePermissions(await requireActor(), { role, permissions });
    revalidatePath("/", "layout");
  });
}
