import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { randomUUID } from "./uuid";

describe("randomUUID", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("nutzt crypto.randomUUID, wenn vorhanden", () => {
    expect(z.string().uuid().safeParse(randomUUID()).success).toBe(true);
  });

  it("liefert ohne crypto.randomUUID (unsicherer Kontext) gültige, eindeutige v4-UUIDs", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: real.getRandomValues.bind(real),
    });
    const ids = new Set(Array.from({ length: 1000 }, () => randomUUID()));
    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(z.string().uuid().safeParse(id).success).toBe(true);
    }
  });
});
