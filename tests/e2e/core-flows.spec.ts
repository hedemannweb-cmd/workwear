import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Dashboard zeigt Kennzahlen und Handlungsbedarf @tablet", async ({ page }, info) => {
  await login(page, "admin");
  await expect(page.getByRole("link", { name: /Aktive Mitarbeiter/ })).toBeVisible();
  await expect(page.getByText(/überfällig/).first()).toBeVisible();
  await expect(page.getByText(/eingetroffene Mitarbeiterartikel warten auf Ausgabe/)).toBeVisible();
  await page.screenshot({ path: `test-results/screens/${info.project.name}-dashboard.png`, fullPage: true });
});

test("Suche → Schnellansicht → Mitarbeiterseite mit Kontingent (Beispiel 4711)", async ({ page }) => {
  await login(page, "manager");
  await page.getByRole("button", { name: "Suche öffnen" }).click();
  await page.getByPlaceholder(/Name, Personalnummer/).fill("Musterman"); // fehlertolerant (Tippfehler)
  await expect(page.getByText("Max Mustermann")).toBeVisible();
  await expect(page.getByText(/T-Shirt: 2 verfügbar/)).toBeVisible();
  await page.screenshot({ path: "test-results/screens/search.png" });
  await page.getByText("Max Mustermann").click();

  await expect(page.getByRole("heading", { name: /Max Mustermann/ })).toBeVisible();
  const shirtRow = page.getByRole("row", { name: /T-Shirt/ }).first();
  await expect(shirtRow).toContainText("5");
  await expect(shirtRow.getByRole("cell").nth(5)).toHaveText("2");
  await page.screenshot({ path: "test-results/screens/employee.png", fullPage: true });

  // Nachweis öffnen
  await shirtRow.click();
  await expect(page.getByText(/Nachweis aller Buchungen/)).toBeVisible();
  await expect(page.getByText(/Ausgabe A-\d{4}-\d{6}: 2 × T-Shirt Basic/)).toBeVisible();
  await page.screenshot({ path: "test-results/screens/ledger.png" });
  await page.keyboard.press("Escape");
});

test("Kleidung ausgeben: Gruppe → Größe (vorbelegt) → Ausgeben", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/employees");
  await page.getByText("Mustermann, Max").click();
  await page.getByRole("button", { name: /Kleidung ausgeben/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Sicherheitsschuhe/ }).click();
  // Mitarbeitergröße 44 ist vorausgewählt
  await expect(dialog.getByRole("button", { name: /44.*Mitarbeitergröße/ })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/screens/issue-dialog.png" });
  await dialog.getByRole("button", { name: "Ausgeben" }).click();
  await expect(page.getByText(/Ausgabe A-\d{4}-\d{6} gebucht/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Sicherheitsschuhe/ }).first().getByRole("cell").nth(5)).toHaveText("0");
});

test("Nicht am Lager → Bestellen reserviert Kontingent und erscheint im Bedarf", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/employees");
  await page.getByText("Mustermann, Max").click();
  await page.getByRole("button", { name: /Kleidung ausgeben/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Polo-Shirt/ }).click();
  await dialog.getByRole("button", { name: /3XL/ }).click();
  await expect(dialog.getByText(/wird bestellt/)).toBeVisible();
  await dialog.getByRole("button", { name: "Bestellen" }).click();
  await expect(page.getByText(/Kontingent ist reserviert/)).toBeVisible();
  await page.goto("/orders?tab=bedarf");
  await expect(page.getByRole("row", { name: /Max Mustermann.*Polo-Shirt/ })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/demand.png", fullPage: true });
});

test("Teillieferung: Wareneingang bucht Rest und reserviert für Mitarbeiter", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/orders?tab=offen");
  await page.getByRole("row", { name: /Teilweise geliefert/ }).click();
  await expect(page.getByRole("heading", { name: /Bestellung B-/ })).toBeVisible();
  await page.getByRole("button", { name: "Wareneingang buchen" }).click();
  const dialog = page.getByRole("dialog");
  await page.screenshot({ path: "test-results/screens/receipt-dialog.png" });
  await dialog.getByRole("button", { name: "Wareneingang buchen" }).click();
  await expect(page.getByText(/Wareneingang W-\d{4}-\d{6}/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Geliefert/ })).toBeVisible();
});

test("Verantwortlicher mit Abteilungs-Scope: keine fremden Mitarbeiter, keine Administration", async ({ page }) => {
  await login(page, "lager");
  await expect(page.getByRole("link", { name: "Benutzer" })).toHaveCount(0);
  await page.goto("/employees");
  await expect(page.getByText("Mustermann, Max")).toHaveCount(0);
  await expect(page.getByText("Richter, Kevin")).toBeVisible();
  await page.goto("/admin/users");
  await expect(page.getByText("Kein Zugriff")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/responsible-employees.png" });
});
