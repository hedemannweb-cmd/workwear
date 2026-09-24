import { getOrder } from "@/modules/orders/server/queries";
import { can, getCurrentActor } from "@/server/actor";
import { isDomainError } from "@/server/errors";
import { toCsv } from "@/lib/csv";

/** Bestellung als CSV (Excel-kompatibel, Semikolon, UTF-8 mit BOM) zum Versand an den Lieferanten. */
export async function GET(_req: Request, ctx: RouteContext<"/api/orders/[id]/csv">) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Nicht angemeldet", { status: 401 });
  if (!can(actor, "order:view")) return new Response("Keine Berechtigung", { status: 403 });
  const { id } = await ctx.params;
  try {
    const order = await getOrder(id);
    const csv = toCsv(
      ["Bestellnummer", "Lieferant", "Artikelnummer Lieferant", "Unsere SKU", "Artikel", "Menge", "Einzelpreis", "Summe"],
      order.items.map((i) => [
        order.orderNumber,
        order.supplier.name,
        i.supplierSku ?? "",
        i.sku,
        i.label,
        i.quantityOrdered - i.quantityReceived,
        i.unitPrice.toFixed(2).replace(".", ","),
        ((i.quantityOrdered - i.quantityReceived) * i.unitPrice).toFixed(2).replace(".", ","),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${order.orderNumber}.csv"`,
      },
    });
  } catch (e) {
    if (isDomainError(e)) return new Response("Nicht gefunden", { status: 404 });
    throw e;
  }
}
