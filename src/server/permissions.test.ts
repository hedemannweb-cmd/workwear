import { describe, expect, it } from "vitest";
import { CONFIGURABLE_ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, PERMISSIONS } from "./permissions";

describe("Berechtigungen", () => {
  it("die Rechteverwaltung zeigt jede Berechtigung genau einmal", () => {
    const shown = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
    expect([...shown].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("Standardrechte enthalten nur bekannte Berechtigungen", () => {
    for (const role of CONFIGURABLE_ROLES) {
      for (const p of DEFAULT_ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });
});
