"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { deleteCategory, saveCategory, type categorySchema } from "./server/categories";

export async function saveCategoryAction(id: string | null, input: z.input<typeof categorySchema>) {
  return runAction("saveCategory", async () => {
    await saveCategory(await requireActor(), id, input);
    revalidatePath("/admin/categories");
  });
}

export async function deleteCategoryAction(id: string) {
  return runAction("deleteCategory", async () => {
    await deleteCategory(await requireActor(), id);
    revalidatePath("/admin/categories");
  });
}
