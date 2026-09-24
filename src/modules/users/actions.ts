"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { createUser, resetPassword, updateUser, type createUserSchema, type userSchema } from "./server/users";

export async function createUserAction(input: z.input<typeof createUserSchema>) {
  return runAction("createUser", async () => {
    await createUser(await requireActor(), input);
    revalidatePath("/admin/users");
  });
}

export async function updateUserAction(id: string, input: z.input<typeof userSchema>) {
  return runAction("updateUser", async () => {
    await updateUser(await requireActor(), id, input);
    revalidatePath("/admin/users");
  });
}

export async function resetPasswordAction(id: string, password: string) {
  return runAction("resetPassword", async () => {
    await resetPassword(await requireActor(), id, password);
  });
}
