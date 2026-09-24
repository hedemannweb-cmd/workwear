import { beforeEach, describe, expect, it } from "vitest";
import { currentYear } from "@/lib/dates";
import { receiveGoods } from "@/modules/goods-receipts/server/receive-goods";
import { issueClothing } from "@/modules/issues/server/issue-clothing";
import { cancelOrder, createPurchaseOrder, markOrderOrdered } from "@/modules/orders/server/orders";
import { getEmployeeQuota } from "@/modules/quotas/server/quota-service";
import { cancelReservation, reserveClothing } from "@/modules/reservations/server/reservations";
import { exchangeClothing, returnClothing } from "@/modules/returns/server/returns";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { assertJournalConsistent, inventoryOf, makeActor, makeEmployee, makeWorld, resetDb, rid, stock, type World } from "./fixtures";

const YEAR = currentYear();
let world: World;

beforeEach(async () => {
  await resetDb();
  world = await makeWorld();
});

async function quotaLine(employeeId: string, groupId: string, year = YEAR) {
  return (await getEmployeeQuota(employeeId, year, { includeGroupIds: [groupId] })).find((l) => l.quotaGroupId === groupId)!;
}

async function reserve(employeeId: string, variantId: string, quantity: number) {
  const { reservationIds } = await reserveClothing(world.admin, { employeeId, clientRequestId: rid(), items: [{ articleVariantId: variantId, quantity }] });
  return reservationIds[0]!;
}

async function orderFor(reservationIds: string[], stockItems: Array<{ articleVariantId: string; quantity: number }> = []) {
  const { orderId } = await createPurchaseOrder(world.admin, { supplierId: world.supplier.id, reservationIds, stockItems });
  await markOrderOrdered(world.admin, { orderId, orderDate: `${YEAR}-01-10` });
  return db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
}

describe("Sammelbestellung", () => {
  it("fasst Reservierungen je Variante zusammen, jede Reservierung bleibt zugeordnet", async () => {
    const a = await makeEmployee(world.departments.prod.id);
    const b = await makeEmployee(world.departments.prod.id);
    const rA = await reserve(a.id, world.variants.shirtXL, 2);
    const rB = await reserve(b.id, world.variants.shirtXL, 1);
    const rC = await reserve(b.id, world.variants.shirtL, 1);

    const order = await orderFor([rA, rB, rC], [{ articleVariantId: world.variants.shirtXL, quantity: 5 }]);

    const xl = order.items.find((i) => i.articleVariantId === world.variants.shirtXL)!;
    const l = order.items.find((i) => i.articleVariantId === world.variants.shirtL)!;
    expect(xl.quantityOrdered).toBe(8); // 2 + 1 Mitarbeiter + 5 Lager
    expect(l.quantityOrdered).toBe(1);
    expect(xl.unitPrice.toString()).toBe("7.5");
    expect(order.orderNumber).toMatch(/^B-/);
    expect(order.expectedDeliveryDate?.toISOString().slice(0, 10)).toBe(`${YEAR}-01-24`); // 14 Tage Lieferzeit

    const res = await db.employeeReservation.findMany({ where: { id: { in: [rA, rB, rC] } } });
    expect(res.every((r) => r.status === "ORDERED")).toBe(true);
    expect(res.filter((r) => r.orderItemId === xl.id)).toHaveLength(2);
  });

  it("gleichzeitig bestellte Reservierung wird nicht doppelt bestellt", async () => {
    const a = await makeEmployee(world.departments.prod.id);
    const r = await reserve(a.id, world.variants.shirtXL, 1);
    const results = await Promise.allSettled([
      createPurchaseOrder(world.admin, { supplierId: world.supplier.id, reservationIds: [r] }),
      createPurchaseOrder(world.admin, { supplierId: world.supplier.id, reservationIds: [r] }),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("Stornierung der Bestellung setzt Reservierungen auf offen zurück", async () => {
    const a = await makeEmployee(world.departments.prod.id);
    const r = await reserve(a.id, world.variants.shirtXL, 1);
    const order = await orderFor([r]);
    await cancelOrder(world.admin, { orderId: order.id, reason: "Lieferant kann nicht liefern" });
    const res = await db.employeeReservation.findUniqueOrThrow({ where: { id: r } });
    expect(res).toMatchObject({ status: "PENDING", orderItemId: null });
    expect(await quotaLine(a.id, world.groups.shirt.id)).toMatchObject({ reserved: 1 });
  });

  it("RESPONSIBLE darf keine Bestellungen anlegen (BDR-12)", async () => {
    const responsible = await makeActor("RESPONSIBLE");
    await expect(
      createPurchaseOrder(responsible, { supplierId: world.supplier.id, stockItems: [{ articleVariantId: world.variants.shirtM, quantity: 1 }] }),
    ).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === "FORBIDDEN");
  });
});

describe("Wareneingang", () => {
  it("Teillieferung: 10 bestellt, 6 geliefert → 4 offen, FIFO-Zuteilung mit Split", async () => {
    const a = await makeEmployee(world.departments.prod.id);
    const b = await makeEmployee(world.departments.prod.id);
    const rA = await reserve(a.id, world.variants.shirtXL, 3); // älteste Reservierung
    const rB = await reserve(b.id, world.variants.shirtXL, 4);
    const order = await orderFor([rA, rB], [{ articleVariantId: world.variants.shirtXL, quantity: 3 }]); // 10 gesamt
    const item = order.items[0]!;

    const result = await receiveGoods(world.admin, { orderId: order.id, clientRequestId: rid(), items: [{ orderItemId: item.id, quantity: 6 }] });
    expect(result).toMatchObject({ reservedForEmployees: 6, toFreeStock: 0, issuedDirectly: 0 });

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(after.status).toBe("PARTIALLY_RECEIVED");
    expect(after.items[0]).toMatchObject({ quantityOrdered: 10, quantityReceived: 6 });

    const resA = await db.employeeReservation.findUniqueOrThrow({ where: { id: rA } });
    expect(resA).toMatchObject({ status: "RECEIVED", quantity: 3 });
    const resB = await db.employeeReservation.findUniqueOrThrow({ where: { id: rB } });
    expect(resB).toMatchObject({ status: "RECEIVED", quantity: 3 });
    const split = await db.employeeReservation.findFirstOrThrow({ where: { splitFromId: rB } });
    expect(split).toMatchObject({ status: "ORDERED", quantity: 1, orderItemId: item.id });

    // Kontingent unverändert: B hat weiterhin 4 reserviert
    expect(await quotaLine(b.id, world.groups.shirt.id)).toMatchObject({ reserved: 4, available: 1 });
    expect(await inventoryOf(world, world.variants.shirtXL)).toEqual({ physical: 6, reserved: 6 });

    // Restlieferung: 1 für B (Split), 3 Lagerware
    const rest = await receiveGoods(world.admin, { orderId: order.id, clientRequestId: rid(), items: [{ orderItemId: item.id, quantity: 4 }] });
    expect(rest).toMatchObject({ reservedForEmployees: 1, toFreeStock: 3 });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RECEIVED");
    expect(await inventoryOf(world, world.variants.shirtXL)).toEqual({ physical: 10, reserved: 7 });
    await assertJournalConsistent();
  });

  it("reservierte Ware steht nicht für andere Mitarbeiter zur Verfügung und wird an den Berechtigten ausgegeben", async () => {
    const a = await makeEmployee(world.departments.prod.id);
    const other = await makeEmployee(world.departments.prod.id);
    const rA = await reserve(a.id, world.variants.pants54, 1);
    const order = await orderFor([rA]);
    await receiveGoods(world.admin, { orderId: order.id, clientRequestId: rid(), items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] });

    await expect(
      issueClothing(world.admin, { employeeId: other.id, clientRequestId: rid(), items: [{ articleVariantId: world.variants.pants54, quantity: 1 }] }),
    ).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === "STOCK_INSUFFICIENT");

    await issueClothing(world.admin, {
      employeeId: a.id,
      clientRequestId: rid(),
      items: [{ articleVariantId: world.variants.pants54, quantity: 1, reservationId: rA }],
    });
    expect(await inventoryOf(world, world.variants.pants54)).toEqual({ physical: 0, reserved: 0 });
    expect(await quotaLine(a.id, world.groups.pants.id)).toMatchObject({ issued: 1, reserved: 0, available: 1 });
    expect((await db.employeeReservation.findUniqueOrThrow({ where: { id: rA } })).status).toBe("ISSUED");
    await assertJournalConsistent();
  });

  it("Direktausgabe beim Wareneingang bucht Zugang und Ausgabe", async () => {
    const a = await makeEmployee(world.departments.prod.id);
    const rA = await reserve(a.id, world.variants.shirtM, 2);
    const order = await orderFor([rA]);
    const res = await receiveGoods(world.admin, {
      orderId: order.id,
      clientRequestId: rid(),
      items: [{ orderItemId: order.items[0]!.id, quantity: 2 }],
      directIssueReservationIds: [rA],
    });
    expect(res.issuedDirectly).toBe(2);
    expect(await inventoryOf(world, world.variants.shirtM)).toEqual({ physical: 0, reserved: 0 });
    expect(await quotaLine(a.id, world.groups.shirt.id)).toMatchObject({ issued: 2, reserved: 0, available: 3 });
    const types = (await db.inventoryMovement.findMany({ where: { articleVariantId: world.variants.shirtM }, orderBy: { createdAt: "asc" } })).map((m) => m.type);
    expect(types).toEqual(["RECEIPT", "ISSUE"]);
  });

  it("Überlieferung nur mit ausdrücklicher Bestätigung", async () => {
    const order = await orderFor([], [{ articleVariantId: world.variants.shirtM, quantity: 2 }]);
    await expect(
      receiveGoods(world.admin, { orderId: order.id, clientRequestId: rid(), items: [{ orderItemId: order.items[0]!.id, quantity: 3 }] }),
    ).rejects.toThrow(/Überlieferung/);
    await receiveGoods(world.admin, {
      orderId: order.id,
      clientRequestId: rid(),
      items: [{ orderItemId: order.items[0]!.id, quantity: 3 }],
      allowOverDelivery: true,
    });
    expect(await inventoryOf(world, world.variants.shirtM)).toEqual({ physical: 3, reserved: 0 });
  });

  it("Stornierung einer eingetroffenen Reservierung gibt Ware frei", async () => {
    const a = await makeEmployee(world.departments.prod.id);
    const rA = await reserve(a.id, world.variants.shirtL, 1);
    const order = await orderFor([rA]);
    await receiveGoods(world.admin, { orderId: order.id, clientRequestId: rid(), items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] });
    await cancelReservation(world.admin, { reservationId: rA, reason: "Mitarbeiter ausgeschieden" });
    expect(await inventoryOf(world, world.variants.shirtL)).toEqual({ physical: 1, reserved: 0 });
    expect(await quotaLine(a.id, world.groups.shirt.id)).toMatchObject({ reserved: 0, available: 5 });
    await assertJournalConsistent();
  });
});

describe("Rückgabe und Umtausch", () => {
  async function issued(employeeId: string, variantId: string, quantity: number) {
    await stock(world, variantId, quantity + 5);
    const { issueId } = await issueClothing(world.admin, { employeeId, clientRequestId: rid(), items: [{ articleVariantId: variantId, quantity }] });
    return db.clothingIssueItem.findFirstOrThrow({ where: { issueId } });
  }

  it("Rückgabe ins Lager (ungetragen) schreibt Kontingent gut und erhöht den Bestand", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    const item = await issued(emp.id, world.variants.shirtM, 3);
    await expect(
      returnClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ issueItemId: item.id, quantity: 1, returnType: "RETURN_TO_STOCK" }] }),
    ).rejects.toThrow(/ungetragene/);
    await returnClothing(world.admin, {
      employeeId: emp.id,
      clientRequestId: rid(),
      confirmUnworn: true,
      items: [{ issueItemId: item.id, quantity: 1, returnType: "RETURN_TO_STOCK" }],
    });
    expect(await quotaLine(emp.id, world.groups.shirt.id)).toMatchObject({ issued: 2, available: 3 });
    expect(await inventoryOf(world, world.variants.shirtM)).toEqual({ physical: 6, reserved: 0 });
  });

  it("Abschreibung gibt kein Kontingent zurück und bucht nichts ins Lager", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    const item = await issued(emp.id, world.variants.shirtM, 2);
    await returnClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ issueItemId: item.id, quantity: 2, returnType: "WRITE_OFF" }] });
    expect(await quotaLine(emp.id, world.groups.shirt.id)).toMatchObject({ issued: 2, available: 3 });
    expect(await inventoryOf(world, world.variants.shirtM)).toEqual({ physical: 5, reserved: 0 });
  });

  it("mehr zurückgeben als ausgegeben ist nicht möglich", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    const item = await issued(emp.id, world.variants.shirtM, 1);
    await expect(
      returnClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), items: [{ issueItemId: item.id, quantity: 2, returnType: "WRITE_OFF" }] }),
    ).rejects.toThrow(/höchstens noch 1/);
  });

  it("Umtausch Hose 52 → 54 belastet das Kontingent nicht doppelt, beide Bewegungen bleiben nachvollziehbar", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    const item = await issued(emp.id, world.variants.pants52, 2); // Kontingent Hose: 2 → voll verbraucht
    await stock(world, world.variants.pants54, 2);
    expect(await quotaLine(emp.id, world.groups.pants.id)).toMatchObject({ available: 0 });

    const res = await exchangeClothing(world.admin, {
      employeeId: emp.id,
      clientRequestId: rid(),
      issueItemId: item.id,
      quantity: 1,
      newArticleVariantId: world.variants.pants54,
      reason: "passt nicht",
    });

    expect(await quotaLine(emp.id, world.groups.pants.id)).toMatchObject({ issued: 2, available: 0 });
    expect(await inventoryOf(world, world.variants.pants52)).toEqual({ physical: 6, reserved: 0 });
    expect(await inventoryOf(world, world.variants.pants54)).toEqual({ physical: 1, reserved: 0 });

    const newItem = await db.clothingIssueItem.findFirstOrThrow({ where: { issueId: res.issueId } });
    expect(newItem.quotaYear).toBe(item.quotaYear);
    expect(newItem.exchangeOfReturnItemId).not.toBeNull();
    await assertJournalConsistent();
  });

  it("Umtausch nur innerhalb derselben Kontingentgruppe", async () => {
    const emp = await makeEmployee(world.departments.prod.id);
    const item = await issued(emp.id, world.variants.pants52, 1);
    await expect(
      exchangeClothing(world.admin, { employeeId: emp.id, clientRequestId: rid(), issueItemId: item.id, quantity: 1, newArticleVariantId: world.variants.shirtM }),
    ).rejects.toThrow(/derselben Kontingentgruppe/);
  });
});
