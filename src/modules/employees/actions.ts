"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { getSetting } from "@/modules/settings/server/settings";
import { changeDepartment, type changeDepartmentSchema } from "./server/change-department";
import {
  createEmployee,
  pseudonymizeEmployee,
  setEmployeeSizes,
  updateEmployee,
  type EmployeeInput,
  type employeeSizesSchema,
} from "./server/employees";

export async function saveEmployeeAction(id: string | null, input: EmployeeInput) {
  return runAction("saveEmployee", async () => {
    const actor = await requireActor();
    if (id) {
      await updateEmployee(actor, id, input);
      revalidatePath(`/employees/${id}`);
      return { id };
    }
    const e = await createEmployee(actor, input);
    revalidatePath("/employees");
    return { id: e.id };
  });
}

export async function setEmployeeSizesAction(employeeId: string, input: z.input<typeof employeeSizesSchema>) {
  return runAction("setEmployeeSizes", async () => {
    await setEmployeeSizes(await requireActor(), employeeId, input);
    revalidatePath(`/employees/${employeeId}`);
  });
}

export async function changeDepartmentAction(input: z.input<typeof changeDepartmentSchema>) {
  return runAction("changeDepartment", async () => {
    await changeDepartment(await requireActor(), input);
    revalidatePath(`/employees/${input.employeeId}`);
  });
}

export async function pseudonymizeEmployeeAction(employeeId: string) {
  return runAction("pseudonymizeEmployee", async () => {
    const years = await getSetting("privacy.retentionYears");
    await pseudonymizeEmployee(await requireActor(), employeeId, years);
    revalidatePath(`/employees/${employeeId}`);
  });
}
