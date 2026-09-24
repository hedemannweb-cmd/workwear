"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import {
  createVariants,
  saveArticle,
  saveArticleSupplier,
  updateVariant,
  type articleSchema,
  type articleSupplierSchema,
  type variantMatrixSchema,
  type variantUpdateSchema,
} from "./server/articles";

export async function saveArticleAction(id: string | null, input: z.input<typeof articleSchema>) {
  return runAction("saveArticle", async () => {
    const a = await saveArticle(await requireActor(), id, input);
    revalidatePath("/articles");
    revalidatePath(`/articles/${a.id}`);
    return { id: a.id };
  });
}

export async function createVariantsAction(input: z.input<typeof variantMatrixSchema>) {
  return runAction("createVariants", async () => {
    const res = await createVariants(await requireActor(), input);
    revalidatePath(`/articles/${input.articleId}`);
    return res;
  });
}

export async function updateVariantAction(articleId: string, id: string, input: z.input<typeof variantUpdateSchema>) {
  return runAction("updateVariant", async () => {
    await updateVariant(await requireActor(), id, input);
    revalidatePath(`/articles/${articleId}`);
  });
}

export async function saveArticleSupplierAction(input: z.input<typeof articleSupplierSchema>) {
  return runAction("saveArticleSupplier", async () => {
    await saveArticleSupplier(await requireActor(), input);
    revalidatePath(`/articles/${input.articleId}`);
  });
}
