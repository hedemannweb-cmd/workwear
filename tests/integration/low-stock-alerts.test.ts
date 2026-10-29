import { beforeEach, describe, expect, it } from "vitest";
import { issueClothing } from "@/modules/issues/server/issue-clothing";
import { checkLowStockAlerts } from "@/modules/inventory/server/low-stock-alerts";
import { updateSetting } from "@/modules/settings/server/settings";
import { db } from "@/server/db";
import type { Mail } from "@/server/mail";
import { makeActor, makeEmployee, makeWorld, resetDb, rid, stock, type World } from "./fixtures";

let world: World;
let sent: Mail[];
const send = async (mail: Mail) => {
  sent.push(mail);
};
const check = () => checkLowStockAlerts({ send, configured: true });

beforeEach(async () => {
  await resetDb();
  world = await makeWorld();
  sent = [];
  await db.articleVariant.update({
    where: { id: world.variants.shirtXL },
    data: { minStock: 3 },
  });
  await stock(world, world.variants.shirtXL, 5);
  await updateSetting(world.admin, "notifications.lowStockRecipients", ["lager@test.local"], "Test Empfänger");
  await updateSetting(world.admin, "notifications.lowStockNotifyManagers", false, "Test ohne Manager");
});

async function issue(quantity: number) {
  const emp = await makeEmployee(world.departments.prod.id);
  await issueClothing(world.admin, {
    employeeId: emp.id,
    clientRequestId: rid(),
    items: [{ articleVariantId: world.variants.shirtXL, quantity }],
  });
}

describe("Mindestbestand-Mail", () => {
  it("meldet erst beim Erreichen des Mindestbestands und nur einmal je Unterschreitung", async () => {
    await check();
    expect(sent).toHaveLength(0);

    await issue(2); // 3 frei = Mindestbestand erreicht
    await check();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["lager@test.local"]);
    expect(sent[0]!.subject).toContain("T-Shirt");
    expect(sent[0]!.text).toContain("3 frei verfügbar, Mindestbestand 3");

    await issue(1); // weiter darunter: keine zweite Mail
    await check();
    await check();
    expect(sent).toHaveLength(1);

    await stock(world, world.variants.shirtXL, 5); // wieder aufgefüllt (7 frei)
    await check();
    expect(await db.lowStockAlert.count()).toBe(0);

    await issue(4); // erneute Unterschreitung → neue Mail
    await check();
    expect(sent).toHaveLength(2);
  });

  it("schickt optional zusätzlich an alle aktiven Manager, ohne doppelte Adressen", async () => {
    const manager = await makeActor("MANAGER");
    const inactive = await makeActor("MANAGER");
    await db.user.update({
      where: { id: inactive.userId },
      data: { active: false },
    });
    await updateSetting(world.admin, "notifications.lowStockRecipients", ["lager@test.local", manager.email.toUpperCase()], "Test");
    await updateSetting(world.admin, "notifications.lowStockNotifyManagers", true, "Test mit Managern");

    await issue(2);
    await check();
    expect(sent[0]!.to).toHaveLength(2);
    expect(sent[0]!.to).toContain("lager@test.local");
    expect(sent[0]!.to).not.toContain(inactive.email);
  });

  it("merkt sich ohne Empfänger nichts und holt die Mail nach, sobald Empfänger eingetragen sind", async () => {
    await updateSetting(world.admin, "notifications.lowStockRecipients", [], "Test leer");
    await issue(2);
    await check();
    expect(sent).toHaveLength(0);
    expect(await db.lowStockAlert.count()).toBe(0);

    await updateSetting(world.admin, "notifications.lowStockRecipients", ["lager@test.local"], "Test Empfänger");
    await check();
    expect(sent).toHaveLength(1);
  });

  it("versucht es nach einem Versandfehler erneut", async () => {
    await issue(2);
    await checkLowStockAlerts({
      configured: true,
      send: async () => {
        throw new Error("SMTP down");
      },
    });
    expect(await db.lowStockAlert.count()).toBe(0);
    await check();
    expect(sent).toHaveLength(1);
  });

  it("lehnt ungültige Empfänger-Adressen ab", async () => {
    await expect(updateSetting(world.admin, "notifications.lowStockRecipients", ["keine-mail"], "Test ungültig")).rejects.toThrow();
  });
});
