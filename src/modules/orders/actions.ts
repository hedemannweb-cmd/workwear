"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { receiveGoods, type receiveGoodsSchema } from "@/modules/goods-receipts/server/receive-goods";
import { assertCan, requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import {
  cancelOrder,
  confirmOrder,
  createPurchaseOrder,
  markOrderOrdered,
  type cancelOrderSchema,
  type createPurchaseOrderSchema,
  type markOrderedSchema,
} from "./server/orders";
import { getStockOrderCandidates } from "./server/queries";

function revalidateOrders(orderId?: string) {
  revalidatePath("/orders");
  revalidatePath("/");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

export async function createPurchaseOrderAction(input: z.input<typeof createPurchaseOrderSchema>) {
  return runAction("createPurchaseOrder", async () => {
    const res = await createPurchaseOrder(await requireActor(), input);
    revalidateOrders(res.orderId);
    return res;
  });
}

export async function markOrderedAction(input: z.input<typeof markOrderedSchema>) {
  return runAction("markOrdered", async () => {
    await markOrderOrdered(await requireActor(), input);
    revalidateOrders(input.orderId);
  });
}

export async function confirmOrderAction(input: { orderId: string; expectedDeliveryDate?: string }) {
  return runAction("confirmOrder", async () => {
    await confirmOrder(await requireActor(), input);
    revalidateOrders(input.orderId);
  });
}

export async function cancelOrderAction(input: z.input<typeof cancelOrderSchema>) {
  return runAction("cancelOrder", async () => {
    await cancelOrder(await requireActor(), input);
    revalidateOrders(input.orderId);
  });
}

export async function receiveGoodsAction(input: z.input<typeof receiveGoodsSchema>) {
  return runAction("receiveGoods", async () => {
    const res = await receiveGoods(await requireActor(), input);
    revalidateOrders(input.orderId);
    revalidatePath("/goods-receipts");
    revalidatePath("/inventory");
    return res;
  });
}

export async function stockOrderCandidatesAction(supplierId: string) {
  return runAction("stockOrderCandidates", async () => {
    assertCan(await requireActor(), "order:manage");
    return getStockOrderCandidates(String(supplierId));
  }, { readOnly: true });
}
