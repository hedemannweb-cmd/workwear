"use server";

import { requireActor } from "@/server/actor";
import { runAction } from "@/server/action";
import { globalSearch } from "./server/search";

export async function searchAction(query: string) {
  return runAction("search", async () => globalSearch(await requireActor(), String(query ?? "")));
}
