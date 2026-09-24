"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { saveSupplier, type supplierSchema } from "./server/suppliers";

export async function saveSupplierAction(id: string | null, input: z.input<typeof supplierSchema>) {
  return runAction("saveSupplier", async () => {
    await saveSupplier(await requireActor(), id, input);
    revalidatePath("/admin/suppliers");
  });
}
