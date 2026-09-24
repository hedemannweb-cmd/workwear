"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { adjustInventory, transferInventory, type adjustInventorySchema, type transferInventorySchema } from "./server/adjust-inventory";

export async function adjustInventoryAction(input: z.input<typeof adjustInventorySchema>) {
  return runAction("adjustInventory", async () => {
    const res = await adjustInventory(await requireActor(), input);
    revalidatePath("/inventory");
    return res;
  });
}

export async function transferInventoryAction(input: z.input<typeof transferInventorySchema>) {
  return runAction("transferInventory", async () => {
    await transferInventory(await requireActor(), input);
    revalidatePath("/inventory");
  });
}
