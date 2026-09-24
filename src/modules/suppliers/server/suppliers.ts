import "server-only";
import { z } from "zod";
import { type Actor, assertCan } from "@/server/actor";
import { audit, diff } from "@/server/audit";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { runInTransaction } from "@/server/tx";

const optional = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);

export const supplierSchema = z.object({
  supplierNumber: z.string().trim().min(1, "Pflichtfeld").max(20),
  name: z.string().trim().min(2, "Pflichtfeld").max(120),
  contactPerson: optional(120),
  email: z.union([z.email("Ungültige E-Mail-Adresse"), z.literal("")]).nullable().transform((v) => v || null),
  phone: optional(40),
  website: z.union([z.url({ protocol: /^https?$/, error: "Ungültige Adresse (http/https)" }), z.literal("")]).nullable().transform((v) => v || null),
  notes: optional(1000),
  active: z.boolean(),
});

export async function listSuppliers() {
  return db.supplier.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { articles: true, orders: { where: { status: { in: ["ORDERED", "CONFIRMED", "PARTIALLY_RECEIVED"] } } } } } },
  });
}

export async function saveSupplier(actor: Actor, id: string | null, raw: z.input<typeof supplierSchema>) {
  assertCan(actor, "supplier:manage");
  const input = supplierSchema.parse(raw);
  return runInTransaction(async (tx) => {
    if (!id) {
      const s = await tx.supplier.create({ data: input });
      await audit(tx, { actorId: actor.userId, action: "SUPPLIER_CREATED", entityType: "Supplier", entityId: s.id, newValue: input });
      return s;
    }
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) throw notFound("Der Lieferant");
    const s = await tx.supplier.update({ where: { id }, data: input });
    const changes = diff(before, input);
    if (changes) await audit(tx, { actorId: actor.userId, action: "SUPPLIER_UPDATED", entityType: "Supplier", entityId: id, ...changes });
    return s;
  });
}
