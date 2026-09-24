"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { cancelReservation, reserveClothing, type ReserveClothingInput, type cancelReservationSchema } from "@/modules/reservations/server/reservations";
import { exchangeClothing, returnClothing, type exchangeClothingSchema, type returnClothingSchema } from "@/modules/returns/server/returns";
import { adjustQuota, type adjustQuotaSchema } from "@/modules/quotas/server/adjust-quota";
import { cancelIssue, issueClothing, type IssueClothingInput, type cancelIssueSchema } from "./server/issue-clothing";

function revalidateEmployee(employeeId: string) {
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/");
}

export async function issueClothingAction(input: IssueClothingInput) {
  return runAction("issueClothing", async () => {
    const res = await issueClothing(await requireActor(), input);
    revalidateEmployee(input.employeeId);
    revalidatePath("/inventory");
    return res;
  });
}

export async function reserveClothingAction(input: ReserveClothingInput) {
  return runAction("reserveClothing", async () => {
    const res = await reserveClothing(await requireActor(), input);
    revalidateEmployee(input.employeeId);
    revalidatePath("/orders");
    return res;
  });
}

export async function cancelReservationAction(employeeId: string, input: z.input<typeof cancelReservationSchema>) {
  return runAction("cancelReservation", async () => {
    const res = await cancelReservation(await requireActor(), input);
    revalidateEmployee(employeeId);
    revalidatePath("/orders");
    return res;
  });
}

export async function cancelIssueAction(employeeId: string, input: z.input<typeof cancelIssueSchema>) {
  return runAction("cancelIssue", async () => {
    await cancelIssue(await requireActor(), input);
    revalidateEmployee(employeeId);
  });
}

export async function returnClothingAction(input: z.input<typeof returnClothingSchema>) {
  return runAction("returnClothing", async () => {
    const res = await returnClothing(await requireActor(), input);
    revalidateEmployee(input.employeeId);
    return res;
  });
}

export async function exchangeClothingAction(input: z.input<typeof exchangeClothingSchema>) {
  return runAction("exchangeClothing", async () => {
    const res = await exchangeClothing(await requireActor(), input);
    revalidateEmployee(input.employeeId);
    return res;
  });
}

export async function adjustQuotaAction(input: z.input<typeof adjustQuotaSchema>) {
  return runAction("adjustQuota", async () => {
    const res = await adjustQuota(await requireActor(), input);
    revalidateEmployee(input.employeeId);
    return res;
  });
}
