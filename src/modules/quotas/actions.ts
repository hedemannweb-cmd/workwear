"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { saveQuotaGroup, saveQuotaProfile, setQuotaRule, type quotaGroupSchema, type quotaProfileSchema, type quotaRuleSchema } from "./server/admin";

export async function saveQuotaGroupAction(id: string | null, input: z.input<typeof quotaGroupSchema>) {
  return runAction("saveQuotaGroup", async () => {
    await saveQuotaGroup(await requireActor(), id, input);
    revalidatePath("/admin/quotas");
  });
}

export async function saveQuotaProfileAction(id: string | null, input: z.input<typeof quotaProfileSchema>) {
  return runAction("saveQuotaProfile", async () => {
    await saveQuotaProfile(await requireActor(), id, input);
    revalidatePath("/admin/quotas");
  });
}

export async function setQuotaRuleAction(input: z.input<typeof quotaRuleSchema>) {
  return runAction("setQuotaRule", async () => {
    await setQuotaRule(await requireActor(), input);
    revalidatePath("/admin/quotas");
  });
}
