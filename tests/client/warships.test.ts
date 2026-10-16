/** Selecting your warships by clicking them (the user after playing 2B.6). */
import { describe, expect, it } from "vitest";
import { warshipAtPoint, warshipSize } from "../../src/client/app/boats.ts";
import type { WarshipSnapshot } from "../../src/sim/frame.ts";

const WIDTH = 100;
const at = (x: number, y: number) => y * WIDTH + x;

function ship(id: number, owner: number, tile: number, readyTick = -1): WarshipSnapshot {
  return {
    id,
    owner,
    base: 1,
    hp: 1_000,
    fromTile: tile,
    route: new Int32Array(0),
    toTile: tile,
    legTick: 0,
    tilesPerTick: 1.5,
    readyTick,
    targetKind: "",
    patrolTile: -1,
  };
}

describe("clicking a warship", () => {
  const ships = [ship(1, 1, at(10, 10)), ship(2, 2, at(12, 10)), ship(3, 1, at(30, 30), 500)];

  it("finds your own warship at sea under the point", () => {
    expect(warshipAtPoint(ships, 1, WIDTH, 0, 10.5, 10.5, 1.5)?.id).toBe(1);
    expect(warshipAtPoint(ships, 1, WIDTH, 0, 11.6, 10.5, 1.5)?.id).toBe(1);
  });

  it("never someone else's, nor one in the shipyard, nor empty sea", () => {
    expect(warshipAtPoint(ships, 1, WIDTH, 0, 12.5, 10.5, 0.5)).toBeNull();
    expect(warshipAtPoint(ships, 1, WIDTH, 0, 30.5, 30.5, 1.5)).toBeNull();
    expect(warshipAtPoint(ships, 1, WIDTH, 0, 50, 50, 1.5)).toBeNull();
  });

  it("is drawn bigger when zoomed in, within bounds", () => {
    expect(warshipSize(1)).toBe(20);
    expect(warshipSize(6)).toBe(39);
    expect(warshipSize(100)).toBe(52);
  });
});
