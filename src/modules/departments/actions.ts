"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { createDepartment, updateDepartment, type departmentSchema } from "./server/departments";
import type { z } from "zod";

export async function saveDepartmentAction(id: string | null, input: z.input<typeof departmentSchema>) {
  return runAction("saveDepartment", async () => {
    const actor = await requireActor();
    if (id) await updateDepartment(actor, id, input);
    else await createDepartment(actor, input);
    revalidatePath("/departments");
  });
}
