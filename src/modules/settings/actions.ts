"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { updateSetting, type SettingKey } from "./server/settings";

export async function updateSettingAction(key: SettingKey, value: unknown, reason: string) {
  return runAction("updateSetting", async () => {
    await updateSetting(await requireActor(), key, value, reason);
    revalidatePath("/admin/settings");
  });
}
