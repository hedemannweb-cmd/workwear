import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("nutzt Semikolon, BOM und maskiert Sonderzeichen", () => {
    const csv = toCsv(["A", "B"], [["x;y", 'Zitat "a"'], [1, null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x;y";"Zitat ""a"""');
    expect(csv).toContain("1;\r\n");
  });
  it("verhindert Formel-Injection", () => {
    expect(toCsv(["A"], [["=HYPERLINK(1)"]])).toContain("'=HYPERLINK(1)");
  });
});
