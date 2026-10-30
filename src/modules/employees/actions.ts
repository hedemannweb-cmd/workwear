"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { getSetting } from "@/modules/settings/server/settings";
import { DomainError } from "@/server/errors";
import { changeDepartment, type changeDepartmentSchema } from "./server/change-department";
import {
  createEmployee,
  pseudonymizeEmployee,
  setEmployeeSizes,
  updateEmployee,
  type EmployeeInput,
  type employeeSizesSchema,
} from "./server/employees";
import { commitEmployeeImport, previewEmployeeImport } from "./server/import";

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

async function uploadedFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new DomainError("VALIDATION", "Bitte eine Excel-Datei auswählen.");
  return { name: file.name, data: await file.arrayBuffer() };
}

export async function previewEmployeeImportAction(formData: FormData) {
  return runAction(
    "previewEmployeeImport",
    async () => {
      const file = await uploadedFile(formData);
      return previewEmployeeImport(await requireActor(), file.data);
    },
    { readOnly: true },
  );
}

export async function commitEmployeeImportAction(formData: FormData) {
  return runAction("commitEmployeeImport", async () => {
    const file = await uploadedFile(formData);
    const result = await commitEmployeeImport(await requireActor(), file.data, file.name);
    revalidatePath("/employees");
    return result;
  });
}
