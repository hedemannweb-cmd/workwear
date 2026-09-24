import { beforeEach, describe, expect, it, vi } from "vitest";

describe("env()", () => {
  beforeEach(() => vi.resetModules());

  it("akzeptiert eine gültige Konfiguration", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@postgres:5432/db");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(40));
    vi.stubEnv("BETTER_AUTH_URL", "https://arbeitskleidung.intern");
    const { env } = await import("./env");
    expect(env().DATABASE_URL).toBe("postgresql://u:p@postgres:5432/db");
  });

  it("meldet fehlende/ungültige Werte verständlich", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://u:p@db/x");
    vi.stubEnv("BETTER_AUTH_SECRET", "kurz");
    vi.stubEnv("BETTER_AUTH_URL", "https://arbeitskleidung.intern");
    const { env } = await import("./env");
    expect(() => env()).toThrow(/DATABASE_URL.*BETTER_AUTH_SECRET muss mindestens 32 Zeichen/);
  });
});
