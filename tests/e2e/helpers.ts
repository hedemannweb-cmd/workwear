import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export const USERS = { admin: "admin@example.com", manager: "manager@example.com", lager: "lager@example.com" } as const;

export async function login(page: Page, user: keyof typeof USERS) {
  const { password } = JSON.parse(readFileSync("test-results/.e2e-credentials.json", "utf8")) as { password: string };
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(USERS[user]);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}
