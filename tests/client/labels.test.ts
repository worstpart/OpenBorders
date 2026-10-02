import { describe, expect, it } from "vitest";
import { computeLabelPlacements } from "../../src/client/render/labels.ts";
import { parseAscii } from "../helpers/asciiMap.ts";

describe("label placement", () => {
  it("centers a label in a round territory", () => {
    const rows = Array.from({ length: 40 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => ((x - 20) ** 2 + (y - 20) ** 2 <= 100 ? "1" : ".")).join(
        "",
      ),
    ).join("\n");
    const { width, height, owners } = parseAscii(rows);
    const place = computeLabelPlacements(owners, width, height).get(1)!;
    expect(place.x).toBeCloseTo(20.5, 0);
    expect(place.y).toBeCloseTo(20.5, 0);
    expect(place.radius).toBeGreaterThan(6);
  });

  it("puts each label in its owner's widest area", () => {
    // Player 1 has a thin strip on the left and a wide block on the right.
    const rows = Array.from({ length: 32 }, () => "1" + ".".repeat(7) + "1".repeat(24)).join("\n");
    const { width, height, owners } = parseAscii(rows);
    const place = computeLabelPlacements(owners, width, height).get(1)!;
    expect(place.x).toBeGreaterThan(14);
  });

  it("gives every owner large enough to see a label, and none to neutral land", () => {
    const { width, height, owners } = parseAscii(
      Array.from({ length: 16 }, () => "1".repeat(16) + "2".repeat(16)).join("\n"),
    );
    const placements = computeLabelPlacements(owners, width, height);
    expect([...placements.keys()].sort()).toEqual([1, 2]);
    expect(placements.get(1)!.x).toBeLessThan(16);
    expect(placements.get(2)!.x).toBeGreaterThan(16);
  });
});
