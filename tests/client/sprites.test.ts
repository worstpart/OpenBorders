/** The icon pack's sprites (D-028, milestone 2B.0b): which art each thing on the map gets. */
import { describe, expect, it } from "vitest";
import { boatLevel } from "../../src/client/app/boats.ts";
import { FACES_LEFT, spriteUrl, type SpriteKind } from "../../src/client/sprites.ts";
import type { BuildingSnapshot } from "../../src/sim/frame.ts";
import { BUILDING_TYPES, DEFAULT_RULES } from "../../src/sim/rules.ts";

const KINDS: SpriteKind[] = [
  "housing",
  "factory",
  "port",
  "airport",
  "plane",
  "helicopter",
  "boat",
  "tradeShip",
];

const WIDTH = 200;
const at = (x: number, y: number) => y * WIDTH + x;

function port(id: number, owner: number, tile: number, level: number): BuildingSnapshot {
  return {
    id,
    type: "port",
    owner,
    tile,
    level,
    targetLevel: level,
    startTick: -1,
    readyTick: -1,
    reloads: [],
    cooldowns: [],
  };
}

describe("sprites", () => {
  it("exist for every kind and level, and every building type has one", () => {
    for (const kind of KINDS) {
      for (const level of [1, 2, 3]) expect(spriteUrl(kind, level)).toMatch(/\.png/);
    }
    for (const type of BUILDING_TYPES) expect(KINDS).toContain(type);
  });

  it("show a building under construction (level 0) as level I", () => {
    expect(spriteUrl("housing", 0)).toBe(spriteUrl("housing", 1));
    expect(spriteUrl("housing", 7)).toBe(spriteUrl("housing", 3));
  });

  it("know which way every vehicle faces, so it can be mirrored by heading", () => {
    for (const kind of ["plane", "helicopter", "boat", "tradeShip"] as const) {
      expect(typeof FACES_LEFT[kind]).toBe("boolean");
    }
  });

  it("draw a boat in the era of its owner's best Port in range of its launch coast", () => {
    const range = DEFAULT_RULES.buildings.types.port.levels[0]!.range!;
    const launch = at(50, 50);
    const buildings = [
      port(1, 1, at(50 + range, 50), 1), // in range (on the edge)
      port(2, 1, at(50, 50 + range + 1), 2), // out of range
      port(3, 2, at(51, 50), 2), // someone else's
    ];
    expect(boatLevel(DEFAULT_RULES, WIDTH, buildings, 1, launch)).toBe(1);
    expect(boatLevel(DEFAULT_RULES, WIDTH, [], 1, launch)).toBe(1);
    expect(boatLevel(DEFAULT_RULES, WIDTH, buildings, 2, launch)).toBe(2);
    buildings.push(port(4, 1, at(45, 45), 2));
    expect(boatLevel(DEFAULT_RULES, WIDTH, buildings, 1, launch)).toBe(2);
    // A Port still being built gives nothing yet.
    expect(boatLevel(DEFAULT_RULES, WIDTH, [port(5, 1, at(52, 50), 0)], 1, launch)).toBe(1);
  });
});
