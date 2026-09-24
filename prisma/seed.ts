/**
 * Demo- und Erstdaten.
 *
 *   npm run db:seed                 → Standard: Administrator + Grunddaten + realistische Demodaten
 *   SEED_DEMO=false npm run db:seed → nur Administrator, Lagerorte, Größenskalen (für Produktion)
 *
 * Bewegungsdaten (Bestände, Ausgaben, Reservierungen, Bestellungen, Wareneingänge) werden über die
 * echten Domänenprozesse erzeugt – damit gelten auch hier alle Invarianten (Journal, Kontingent, Audit).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { dateOnly, currentYear } from "../src/lib/dates";
import type { Actor } from "../src/server/actor";
import { db } from "../src/server/db";
import { runInTransaction } from "../src/server/tx";
import { createUser } from "../src/modules/users/server/users";
import { adjustInventory } from "../src/modules/inventory/server/adjust-inventory";
import { issueClothing } from "../src/modules/issues/server/issue-clothing";
import { reserveClothing } from "../src/modules/reservations/server/reservations";
import { cancelOrder, createPurchaseOrder, markOrderOrdered, confirmOrder } from "../src/modules/orders/server/orders";
import { receiveGoods } from "../src/modules/goods-receipts/server/receive-goods";
import { importHistoricalIssue } from "../src/modules/import/server/historical-issues";
import { adjustQuota } from "../src/modules/quotas/server/adjust-quota";

const YEAR = currentYear();
const rid = () => randomUUID();

export async function seed() {
  if ((await db.user.count()) > 0) {
    console.log("Die Datenbank enthält bereits Benutzer – Seed wird übersprungen. (Zurücksetzen: npm run db:reset)");
    return;
  }
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) throw new Error("SEED_ADMIN_EMAIL und SEED_ADMIN_PASSWORD müssen gesetzt sein.");

  const scales = await createBaseData();
  const adminUser = await createUser(null, {
    name: "Administrator",
    email: adminEmail,
    password: adminPassword,
    role: "ADMIN",
    active: true,
    restrictedToDepartments: false,
    departmentIds: [],
  });
  console.log(`✔ Administrator ${adminEmail} angelegt`);

  if (process.env.SEED_DEMO === "false") return;
  await createDemoData(toActor(adminUser), scales, adminPassword);
}

function toActor(u: { id: string; name: string; email: string; role: Actor["role"] }, departmentIds: string[] | null = null): Actor {
  return { userId: u.id, name: u.name, email: u.email, role: u.role, departmentIds };
}

async function createBaseData() {
  await db.inventoryLocation.createMany({
    data: [
      { code: "HAUPT", name: "Hauptlager", isDefault: true },
      { code: "AUSSCHUSS", name: "Ausschuss / Reklamation", type: "DEFECTIVE" },
    ],
  });
  const textile = await db.sizeScale.create({
    data: { code: "TEXTIL", name: "Textil", sortOrder: 1, sizes: { create: ["XS", "S", "M", "L", "XL", "XXL", "3XL"].map((value, i) => ({ value, sortOrder: i })) } },
    include: { sizes: true },
  });
  const pants = await db.sizeScale.create({
    data: { code: "HOSE", name: "Hosen", sortOrder: 2, sizes: { create: ["46", "48", "50", "52", "54", "56", "58", "60"].map((value, i) => ({ value, sortOrder: i })) } },
    include: { sizes: true },
  });
  const shoes = await db.sizeScale.create({
    data: { code: "SCHUH", name: "Schuhe", sortOrder: 3, sizes: { create: Array.from({ length: 10 }, (_, i) => ({ value: String(39 + i), sortOrder: i })) } },
    include: { sizes: true },
  });
  await db.appSetting.createMany({
    data: [
      { key: "quota.entryRule", value: "PRORATED" },
      { key: "privacy.retentionYears", value: 1 },
      { key: "issue.responsibleCancelSameDayOnly", value: true },
    ],
  });
  console.log("✔ Lagerorte, Größenskalen, Einstellungen");
  return { textile, pants, shoes };
}

type Scales = Awaited<ReturnType<typeof createBaseData>>;

async function createDemoData(admin: Actor, scales: Scales, password: string) {
  // ── Kategorien & Kontingentgruppen ──
  const cat = {
    tops: await db.clothingCategory.create({ data: { name: "Oberteile", sizeScaleId: scales.textile.id, sortOrder: 1 } }),
    jackets: await db.clothingCategory.create({ data: { name: "Jacken", sizeScaleId: scales.textile.id, sortOrder: 2 } }),
    pants: await db.clothingCategory.create({ data: { name: "Hosen", sizeScaleId: scales.pants.id, sortOrder: 3 } }),
    shoes: await db.clothingCategory.create({ data: { name: "Schuhe", sizeScaleId: scales.shoes.id, sortOrder: 4 } }),
  };
  const groupDefs = [
    ["TSHIRT", "T-Shirt"],
    ["POLO", "Polo-Shirt"],
    ["HOSE", "Arbeitshose"],
    ["SWEAT", "Sweatshirt"],
    ["JACKE", "Arbeitsjacke"],
    ["WINTER", "Winterjacke"],
    ["SCHUHE", "Sicherheitsschuhe"],
  ] as const;
  const g: Record<string, string> = {};
  for (const [i, [code, name]] of groupDefs.entries()) {
    g[code] = (await db.quotaGroup.create({ data: { code, name, sortOrder: i + 1 } })).id;
  }

  // ── Lieferanten ──
  const weber = await db.supplier.create({
    data: { supplierNumber: "L-1001", name: "Berufsmode Weber GmbH", contactPerson: "Frau Albrecht", email: "bestellung@weber-berufsmode.example", phone: "+49 521 000000", website: "https://weber-berufsmode.example" },
  });
  const safestep = await db.supplier.create({
    data: { supplierNumber: "L-1002", name: "SafeStep Arbeitsschutz GmbH", contactPerson: "Herr Yilmaz", email: "vertrieb@safestep.example" },
  });
  const nordtex = await db.supplier.create({ data: { supplierNumber: "L-1003", name: "Nordtex Workwear", email: "info@nordtex.example" } });

  // ── Artikel & Varianten ──
  type ArticleDef = { sku: string; name: string; cat: string; group: string; color: string; sizes: typeof scales.textile.sizes; price: string; supplier: string; lead: number; min?: number };
  const defs: ArticleDef[] = [
    { sku: "TS-001", name: "T-Shirt Basic", cat: cat.tops.id, group: g.TSHIRT!, color: "Schwarz", sizes: scales.textile.sizes, price: "7.50", supplier: weber.id, lead: 14, min: 10 },
    { sku: "PO-001", name: "Polo-Shirt", cat: cat.tops.id, group: g.POLO!, color: "Navy", sizes: scales.textile.sizes, price: "14.90", supplier: weber.id, lead: 14, min: 4 },
    { sku: "AH-001", name: "Arbeitshose Bundhose", cat: cat.pants.id, group: g.HOSE!, color: "Grau", sizes: scales.pants.sizes, price: "34.00", supplier: weber.id, lead: 21, min: 3 },
    { sku: "SW-001", name: "Sweatshirt", cat: cat.tops.id, group: g.SWEAT!, color: "Grau meliert", sizes: scales.textile.sizes, price: "24.50", supplier: weber.id, lead: 14, min: 2 },
    { sku: "AJ-001", name: "Arbeitsjacke", cat: cat.jackets.id, group: g.JACKE!, color: "Schwarz", sizes: scales.textile.sizes, price: "49.00", supplier: weber.id, lead: 21, min: 2 },
    { sku: "WJ-001", name: "Winterjacke Softshell", cat: cat.jackets.id, group: g.WINTER!, color: "Schwarz", sizes: scales.textile.sizes, price: "89.00", supplier: weber.id, lead: 28, min: 1 },
    { sku: "SS-001", name: "Sicherheitsschuh S3", cat: cat.shoes.id, group: g.SCHUHE!, color: "Schwarz", sizes: scales.shoes.sizes, price: "72.00", supplier: safestep.id, lead: 10, min: 1 },
  ];
  // Mindestbestand nur für gängige Größen – Randgrößen (XS, 3XL, 46, 60 …) werden bei Bedarf bestellt
  const v: Record<string, string> = {}; // "TS-001:XL" → variantId
  for (const d of defs) {
    const article = await db.article.create({
      data: {
        sku: d.sku,
        name: d.name,
        categoryId: d.cat,
        quotaGroupId: d.group,
        manufacturer: d.supplier === safestep.id ? "SafeStep" : "Weber",
        variants: {
          create: d.sizes.map((s) => ({ variantSku: `${d.sku}-${s.value}`, sizeId: s.id, color: d.color, barcode: `4006${String(defs.indexOf(d) + 1).padStart(3, "0")}${String(s.sortOrder).padStart(3, "0")}`, minStock: d.min && s.sortOrder > 0 && s.sortOrder < d.sizes.length - 1 ? d.min : null })),
        },
        suppliers: { create: { supplierId: d.supplier, purchasePrice: d.price, leadTimeDays: d.lead, isPreferred: true, supplierSku: `W-${d.sku}` } },
      },
      include: { variants: { include: { size: true } } },
    });
    for (const variant of article.variants) v[`${d.sku}:${variant.size!.value}`] = variant.id;
  }
  // Zweitlieferant für T-Shirts (ohne Vorzug)
  const ts = await db.article.findUniqueOrThrow({ where: { sku: "TS-001" } });
  await db.articleSupplier.create({ data: { articleId: ts.id, supplierId: nordtex.id, purchasePrice: "6.90", leadTimeDays: 35 } });
  console.log(`✔ ${defs.length} Artikel mit ${Object.keys(v).length} Varianten, 3 Lieferanten`);

  // ── Kontingentprofile & Abteilungen ──
  const profile = async (code: string, name: string, rules: Array<[string, number]>) =>
    db.quotaProfile.create({
      data: { code, name, rules: { create: rules.map(([group, qty]) => ({ quotaGroupId: g[group]!, validFromYear: 2024, quantityPerYear: qty, createdById: admin.userId })) } },
    });
  const pProd = await profile("PRODUKTION_STANDARD", "Produktion Standard", [["TSHIRT", 5], ["POLO", 2], ["HOSE", 2], ["JACKE", 1], ["SCHUHE", 1]]);
  const pLager = await profile("LAGER_STANDARD", "Lager Standard", [["TSHIRT", 6], ["HOSE", 3], ["SWEAT", 2], ["JACKE", 1], ["WINTER", 1], ["SCHUHE", 1]]);
  const pVerw = await profile("VERWALTUNG_STANDARD", "Verwaltung Standard", [["POLO", 3]]);
  // ab nächstem Jahr: 6 statt 5 T-Shirts in der Produktion (zeigt die Versionierung)
  await db.quotaRule.create({ data: { quotaProfileId: pProd.id, quotaGroupId: g.TSHIRT!, validFromYear: YEAR + 1, quantityPerYear: 6, createdById: admin.userId } });

  const dProd = await db.department.create({ data: { code: "PROD", name: "Produktion", quotaProfileId: pProd.id, costCenter: "4100" } });
  const dLager = await db.department.create({ data: { code: "LAGER", name: "Lager", quotaProfileId: pLager.id, costCenter: "4200" } });
  const dVerw = await db.department.create({ data: { code: "VERW", name: "Verwaltung", quotaProfileId: pVerw.id, costCenter: "1000" } });
  console.log("✔ 3 Abteilungen mit Kontingentprofilen");

  // ── Weitere Benutzer ──
  const demoPassword = process.env.SEED_DEMO_PASSWORD || password;
  const manager = await createUser(null, { name: "Sabine Keller", email: "manager@example.com", password: demoPassword, role: "MANAGER", active: true, restrictedToDepartments: false, departmentIds: [] });
  const responsible = await createUser(null, { name: "Tobias Brandt", email: "lager@example.com", password: demoPassword, role: "RESPONSIBLE", active: true, restrictedToDepartments: true, departmentIds: [dLager.id] });
  const managerActor = toActor(manager);
  const responsibleActor = toActor(responsible, [dLager.id]);
  console.log("✔ Benutzer: manager@example.com (Manager), lager@example.com (Verantwortlicher Lager)");

  // ── Mitarbeiter ──
  type Emp = { nr: string; first: string; last: string; dept: string; entry: string; shirt: string; pants: string; shoe: string; jacket?: string; status?: "ACTIVE" | "INACTIVE" | "LEFT"; exit?: string };
  const emps: Emp[] = [
    { nr: "4711", first: "Max", last: "Mustermann", dept: dProd.id, entry: "2019-03-01", shirt: "XXL", pants: "54", shoe: "44", jacket: "3XL" },
    { nr: "4712", first: "Anna", last: "Schmidt", dept: dProd.id, entry: "2020-06-15", shirt: "M", pants: "46", shoe: "39" },
    { nr: "4713", first: "Mehmet", last: "Yıldız", dept: dProd.id, entry: "2018-01-08", shirt: "L", pants: "52", shoe: "43" },
    { nr: "4714", first: "Julia", last: "Wagner", dept: dProd.id, entry: "2021-09-01", shirt: "S", pants: "48", shoe: "40" },
    { nr: "4715", first: "Thomas", last: "Becker", dept: dProd.id, entry: "2015-04-01", shirt: "XL", pants: "56", shoe: "45" },
    { nr: "4716", first: "Lukas", last: "Hoffmann", dept: dProd.id, entry: "2022-02-01", shirt: "L", pants: "50", shoe: "42" },
    { nr: "4717", first: "Sophie", last: "Schulz", dept: dProd.id, entry: `${YEAR}-07-01`, shirt: "S", pants: "46", shoe: "39" },
    { nr: "4718", first: "Piotr", last: "Nowak", dept: dProd.id, entry: "2017-11-01", shirt: "XL", pants: "54", shoe: "44" },
    { nr: "4719", first: "Stefan", last: "Koch", dept: dProd.id, entry: "2016-05-01", shirt: "L", pants: "52", shoe: "43", status: "LEFT", exit: `${YEAR - 1}-06-30` },
    { nr: "5101", first: "Kevin", last: "Richter", dept: dLager.id, entry: "2019-08-01", shirt: "XL", pants: "54", shoe: "45", jacket: "XL" },
    { nr: "5102", first: "Laura", last: "Klein", dept: dLager.id, entry: "2020-01-15", shirt: "M", pants: "48", shoe: "40" },
    { nr: "5103", first: "Dennis", last: "Wolf", dept: dLager.id, entry: "2021-03-01", shirt: "L", pants: "52", shoe: "44" },
    { nr: "5104", first: "Marco", last: "Neumann", dept: dLager.id, entry: "2014-10-01", shirt: "XXL", pants: "58", shoe: "46" },
    { nr: "5105", first: "Elena", last: "Popescu", dept: dLager.id, entry: "2023-05-01", shirt: "S", pants: "46", shoe: "39", status: "INACTIVE" },
    { nr: "6001", first: "Claudia", last: "Schröder", dept: dVerw.id, entry: "2012-01-01", shirt: "M", pants: "48", shoe: "39" },
    { nr: "6002", first: "Andreas", last: "Zimmermann", dept: dVerw.id, entry: "2018-07-01", shirt: "L", pants: "52", shoe: "43" },
  ];
  const empId: Record<string, string> = {};
  const sizeId = (scale: typeof scales.textile, value: string) => scale.sizes.find((s) => s.value === value)!.id;
  for (const e of emps) {
    const entryDate = dateOnly(e.entry);
    const created = await db.employee.create({
      data: {
        employeeNumber: e.nr,
        firstName: e.first,
        lastName: e.last,
        departmentId: e.dept,
        entryDate,
        exitDate: e.exit ? dateOnly(e.exit) : null,
        status: e.status ?? "ACTIVE",
        departmentHistory: { create: { departmentId: e.dept, validFrom: entryDate, changedById: admin.userId, reason: "Übernahme aus Excel" } },
        sizes: {
          create: [
            { sizeScaleId: scales.textile.id, sizeId: sizeId(scales.textile, e.shirt) },
            { sizeScaleId: scales.pants.id, sizeId: sizeId(scales.pants, e.pants) },
            { sizeScaleId: scales.shoes.id, sizeId: sizeId(scales.shoes, e.shoe) },
            ...(e.jacket ? [{ sizeScaleId: scales.textile.id, categoryId: cat.jackets.id, sizeId: sizeId(scales.textile, e.jacket) }] : []),
          ],
        },
      },
    });
    empId[e.nr] = created.id;
  }
  // Ein Mitarbeiter ohne Größen (Datenqualität)
  await db.employee.create({
    data: {
      employeeNumber: "6003",
      firstName: "Nina",
      lastName: "Braun",
      departmentId: dVerw.id,
      entryDate: dateOnly(`${YEAR}-02-01`),
      departmentHistory: { create: { departmentId: dVerw.id, validFrom: dateOnly(`${YEAR}-02-01`), reason: "Neueinstellung" } },
    },
  });
  console.log(`✔ ${emps.length + 1} Mitarbeiter`);

  // ── Anfangsbestände (Inventurzählung) ──
  const location = await db.inventoryLocation.findFirstOrThrow({ where: { isDefault: true } });
  const stockPlan: Record<string, Record<string, number>> = {
    "TS-001": { XS: 3, S: 8, M: 24, L: 30, XL: 18, XXL: 2, "3XL": 0 },
    "PO-001": { XS: 0, S: 4, M: 1, L: 10, XL: 8, XXL: 2, "3XL": 0 },
    "AH-001": { "46": 2, "48": 4, "50": 6, "52": 8, "54": 7, "56": 1, "58": 0, "60": 0 },
    "SW-001": { S: 2, M: 5, L: 6, XL: 4, XXL: 0 },
    "AJ-001": { M: 2, L: 4, XL: 4, XXL: 0, "3XL": 0 },
    "WJ-001": { L: 2, XL: 0, XXL: 0 },
    "SS-001": { "39": 1, "40": 2, "41": 2, "42": 3, "43": 4, "44": 3, "45": 0, "46": 1 },
  };
  for (const [sku, sizes] of Object.entries(stockPlan)) {
    for (const [size, qty] of Object.entries(sizes)) {
      if (qty === 0) continue;
      await adjustInventory(admin, { mode: "count", articleVariantId: v[`${sku}:${size}`]!, inventoryLocationId: location.id, countedQuantity: qty, reason: "Anfangsbestand (Inventur bei Umstellung)" });
    }
  }
  console.log("✔ Lagerbestände (reichlich / knapp / nicht vorhanden)");

  // ── Historische Ausgaben (Vorjahr + laufendes Jahr, aus der Excel-Übernahme) ──
  const hist = async (nr: string, date: string, items: Array<[string, number]>) =>
    runInTransaction((tx) =>
      importHistoricalIssue(tx, {
        actorId: admin.userId,
        employeeId: empId[nr]!,
        issuedAt: new Date(`${date}T09:30:00+01:00`),
        items: items.map(([key, quantity]) => ({ articleVariantId: v[key]!, quantity })),
        source: "Excel Ausgabeliste",
        clientRequestId: rid(),
      }),
    );
  const prev = YEAR - 1;
  await hist("4711", `${prev}-02-10`, [["TS-001:XXL", 3], ["AH-001:54", 2]]);
  await hist("4711", `${prev}-10-05`, [["TS-001:XXL", 2], ["AJ-001:3XL", 1]]);
  await hist("4713", `${prev}-03-12`, [["TS-001:L", 5], ["PO-001:L", 2], ["SS-001:43", 1]]);
  await hist("5101", `${prev}-01-20`, [["TS-001:XL", 4], ["SW-001:XL", 2], ["WJ-001:XL", 1]]);
  await hist("5104", `${prev}-11-03`, [["AH-001:58", 3]]);
  await hist("4719", `${prev}-03-01`, [["TS-001:L", 2]]);
  // laufendes Jahr: Beispiel aus der Aufgabenstellung (15.01. 2 T-Shirts)
  await hist("4711", `${YEAR}-01-15`, [["TS-001:XXL", 2]]);
  await hist("4711", `${YEAR}-03-04`, [["AH-001:54", 1]]);
  await hist("4712", `${YEAR}-02-03`, [["TS-001:M", 3], ["AH-001:46", 2]]);
  await hist("4713", `${YEAR}-01-22`, [["TS-001:L", 5], ["PO-001:L", 1]]);
  await hist("4715", `${YEAR}-04-17`, [["TS-001:XL", 2], ["SS-001:45", 1]]);
  await hist("4716", `${YEAR}-06-02`, [["PO-001:L", 2], ["AJ-001:L", 1]]);
  await hist("5102", `${YEAR}-03-09`, [["SW-001:M", 1], ["TS-001:M", 2]]);
  await hist("5103", `${YEAR}-05-21`, [["TS-001:L", 6], ["AH-001:52", 2]]);
  await hist("6001", `${YEAR}-02-14`, [["PO-001:M", 2]]);
  console.log("✔ Historische Ausgaben");

  // ── Aktuelle Ausgaben (dieser Monat) über den normalen Prozess ──
  await issueClothing(managerActor, { employeeId: empId["4714"]!, clientRequestId: rid(), items: [{ articleVariantId: v["TS-001:S"]!, quantity: 2 }, { articleVariantId: v["AH-001:48"]!, quantity: 1 }] });
  await issueClothing(responsibleActor, { employeeId: empId["5102"]!, clientRequestId: rid(), items: [{ articleVariantId: v["AH-001:48"]!, quantity: 1 }] });
  await issueClothing(managerActor, { employeeId: empId["4718"]!, clientRequestId: rid(), items: [{ articleVariantId: v["TS-001:XL"]!, quantity: 3 }, { articleVariantId: v["SS-001:44"]!, quantity: 1 }] });
  await issueClothing(managerActor, { employeeId: empId["6002"]!, clientRequestId: rid(), items: [{ articleVariantId: v["PO-001:L"]!, quantity: 1 }] });
  // Sonderfreigabe (BDR-6)
  await issueClothing(managerActor, {
    employeeId: empId["4713"]!,
    clientRequestId: rid(),
    items: [{ articleVariantId: v["TS-001:L"]!, quantity: 1 }],
    override: { reason: "T-Shirt bei Schweißarbeiten beschädigt" },
  });
  // Individuelle Anpassung
  await adjustQuota(admin, { employeeId: empId["4715"]!, quotaGroupId: g.HOSE!, year: YEAR, quantityDelta: 1, reason: "Arbeiten im Nassbereich – erhöhter Verschleiß" });
  console.log("✔ Aktuelle Ausgaben, Sonderfreigabe, Kontingentanpassung");

  // ── Reservierungen (Bedarf) ──
  const reserve = async (actor: Actor, nr: string, key: string, quantity = 1) =>
    (await reserveClothing(actor, { employeeId: empId[nr]!, clientRequestId: rid(), items: [{ articleVariantId: v[key]!, quantity }] })).reservationIds[0]!;

  await reserve(managerActor, "4711", "TS-001:XXL", 1); // Max Mustermann: 5 Anspruch, 2 erhalten, 1 reserviert, 2 verfügbar
  await reserve(responsibleActor, "5101", "WJ-001:XL");
  await reserve(responsibleActor, "5104", "WJ-001:XXL");
  await reserve(responsibleActor, "5101", "SS-001:45");
  await reserve(managerActor, "4715", "AH-001:56", 1);
  // für Sammelbestellungen und Wareneingang
  const r3xlA = await reserve(managerActor, "4711", "AJ-001:3XL");
  const rJacketXxl = await reserve(responsibleActor, "5104", "AJ-001:XXL");
  const rShirt3xlA = await reserve(managerActor, "4718", "TS-001:3XL", 1);
  const rShirt3xlB = await reserve(responsibleActor, "5104", "TS-001:3XL", 2);
  const rPants58 = await reserve(responsibleActor, "5104", "AH-001:58", 1);
  console.log("✔ Offene Mitarbeiterreservierungen");

  // ── Bestellungen ──
  // 1) Überfällige Bestellung (Arbeitsjacken) mit Mitarbeiterbezug
  const o1 = await createPurchaseOrder(managerActor, {
    supplierId: weber.id,
    reservationIds: [r3xlA, rJacketXxl],
    stockItems: [{ articleVariantId: v["AJ-001:XXL"]!, quantity: 2 }],
    notes: "Jacken für Herbst",
  });
  await markOrderOrdered(managerActor, { orderId: o1.orderId, orderDate: isoDaysAgo(35), expectedDeliveryDate: isoDaysAgo(7) });
  await confirmOrder(managerActor, { orderId: o1.orderId });

  // 2) Teillieferung: T-Shirt 3XL (3 für Mitarbeiter + 7 Lager), 6 geliefert
  const o2 = await createPurchaseOrder(managerActor, {
    supplierId: weber.id,
    reservationIds: [rShirt3xlA, rShirt3xlB],
    stockItems: [{ articleVariantId: v["TS-001:3XL"]!, quantity: 7 }, { articleVariantId: v["TS-001:XXL"]!, quantity: 10 }],
  });
  await markOrderOrdered(managerActor, { orderId: o2.orderId, orderDate: isoDaysAgo(20), expectedDeliveryDate: isoDaysAgo(-5) });
  const o2items = await db.orderItem.findMany({ where: { orderId: o2.orderId } });
  await receiveGoods(responsibleActor, {
    orderId: o2.orderId,
    clientRequestId: rid(),
    deliveryNoteNumber: "LS-88213",
    items: o2items.map((i) => ({ orderItemId: i.id, quantity: i.articleVariantId === v["TS-001:3XL"] ? 6 : 4 })),
  });

  // 3) Offene Lagerbestellung (pünktlich)
  const o3 = await createPurchaseOrder(managerActor, {
    supplierId: weber.id,
    reservationIds: [rPants58],
    stockItems: [{ articleVariantId: v["AH-001:56"]!, quantity: 4 }, { articleVariantId: v["AH-001:46"]!, quantity: 4 }],
  });
  await markOrderOrdered(managerActor, { orderId: o3.orderId, orderDate: isoDaysAgo(3) });

  // 4) Vollständig gelieferte Bestellung
  const o4 = await createPurchaseOrder(managerActor, {
    supplierId: safestep.id,
    stockItems: [{ articleVariantId: v["SS-001:42"]!, quantity: 4 }, { articleVariantId: v["SS-001:43"]!, quantity: 4 }],
  });
  await markOrderOrdered(managerActor, { orderId: o4.orderId, orderDate: isoDaysAgo(40) });
  const o4items = await db.orderItem.findMany({ where: { orderId: o4.orderId } });
  await receiveGoods(managerActor, { orderId: o4.orderId, clientRequestId: rid(), deliveryNoteNumber: "SST-4411", items: o4items.map((i) => ({ orderItemId: i.id, quantity: i.quantityOrdered })) });

  // 5) Stornierte Bestellung
  const o5 = await createPurchaseOrder(managerActor, { supplierId: nordtex.id, stockItems: [{ articleVariantId: v["TS-001:M"]!, quantity: 20 }] });
  await markOrderOrdered(managerActor, { orderId: o5.orderId, orderDate: isoDaysAgo(15) });
  await cancelOrder(managerActor, { orderId: o5.orderId, reason: "Lieferant kann Farbe Schwarz nicht liefern" });

  // 6) Entwurf
  await createPurchaseOrder(managerActor, { supplierId: weber.id, stockItems: [{ articleVariantId: v["PO-001:M"]!, quantity: 6 }], notes: "Nachbestellung Polo M" });
  console.log("✔ Bestellungen: überfällig, Teillieferung, offen, geliefert, storniert, Entwurf");

  console.log("\nDemo-Anmeldungen:");
  console.log(`  ${process.env.SEED_ADMIN_EMAIL} (Administrator)`);
  console.log("  manager@example.com (Manager)");
  console.log("  lager@example.com (Verantwortlicher, nur Abteilung Lager)");
  console.log("  Passwort: wie SEED_ADMIN_PASSWORD bzw. SEED_DEMO_PASSWORD");
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}

// Direkt ausgeführt (npm run db:seed) – beim Import aus Tests nicht automatisch starten.
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  seed()
    .then(() => db.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await db.$disconnect();
      process.exit(1);
    });
}
