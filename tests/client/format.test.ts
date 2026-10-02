import { describe, expect, it } from "vitest";
import { formatPercent, formatTroops } from "../../src/client/format.ts";

describe("number formatting", () => {
  it("formats troop counts compactly", () => {
    expect(formatTroops(0)).toBe("0");
    expect(formatTroops(950)).toBe("950");
    expect(formatTroops(1_000)).toBe("1K");
    expect(formatTroops(6_099)).toBe("6.1K");
    expect(formatTroops(12_400)).toBe("12.4K");
    expect(formatTroops(20_330)).toBe("20.3K");
    expect(formatTroops(1_250_000)).toBe("1.25M");
  });

  it("formats shares as percentages", () => {
    expect(formatPercent(0.1834)).toBe("18.3%");
    expect(formatPercent(0)).toBe("0.0%");
  });
});
