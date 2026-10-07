/** SAMs in the HUD (GAME_DESIGN.md §3.17.7, milestone 2B.2). */
import { describe, expect, it } from "vitest";
import {
  buildingCard,
  effectLines,
  upgradeLines,
  type BuildContext,
} from "../../src/client/app/buildings.ts";
import { airliftPreview, isHostile } from "../../src/client/app/flights.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import type { BuildingSnapshot, PlayerSnapshot } from "../../src/sim/frame.ts";
import { createMap, Terrain } from "../../src/sim/map/gameMap.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";

const WIDTH = 80;
const HEIGHT = 20;
const map = createMap(WIDTH, HEIGHT, new Uint8Array(WIDTH * HEIGHT).fill(Terrain.Plains));
const at = (x: number, y: number) => y * WIDTH + x;
// Player 1 on the left, its friend 2 on the right, player 3 in the middle.
const owner = new Uint16Array(WIDTH * HEIGHT).map((_, t) => {
  const x = t % WIDTH;
  return x < 20 ? 1 : x >= 60 ? 2 : 3;
});

const me = { id: 1, homeTroops: 50_000, capacity: 100_000, gold: 0 } as PlayerSnapshot;

function building(overrides: Partial<BuildingSnapshot>): BuildingSnapshot {
  return {
    id: 1,
    type: "sam",
    owner: 1,
    tile: at(5, 5),
    level: 1,
    targetLevel: 1,
    startTick: -1,
    readyTick: -1,
    reloads: [],
    cooldowns: [],
    ...overrides,
  };
}

const ctx = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  rules: DEFAULT_RULES,
  map,
  owner,
  buildings: [],
  walls: [],
  me,
  tick: 100,
  playing: true,
  ...overrides,
});

describe("SAM card", () => {
  it("says what it does, and its interceptors: ready, and when the next one is back", () => {
    expect(effectLines(DEFAULT_RULES, "sam", 1)).toEqual([
      "Shoots down enemy planes within 25 km",
      "1 interceptor, each reloads in 10 s",
    ]);
    const sam = building({ level: 3, targetLevel: 3, reloads: [130, 190] });
    expect(buildingCard(ctx(), sam).sam).toEqual({
      ready: 1,
      max: 3,
      secondsToNext: 3,
      radius: 45,
    });
    expect(buildingCard(ctx(), building({})).sam).toMatchObject({ ready: 1, secondsToNext: 0 });
    // Not while first being built; anyone's SAM shows it (SAMs are in plain sight).
    expect(
      buildingCard(ctx(), building({ level: 0, startTick: 50, readyTick: 150 })).sam,
    ).toBeNull();
    expect(buildingCard(ctx(), building({ owner: 3 })).sam).not.toBeNull();
  });

  it("marks what only comes with missiles as later", () => {
    expect(upgradeLines(DEFAULT_RULES, "sam", 1)).toEqual([
      "Radius 35 km",
      "2 interceptors, reload 8 s each",
      "Later: also intercepts missiles (with Missile Silos)",
    ]);
    expect(upgradeLines(DEFAULT_RULES, "sam", 2).at(-1)).toMatch(/^Later: /);
  });
});

describe("airlift preview and SAMs", () => {
  const airport = building({ id: 9, type: "airport", tile: at(10, 10) });
  const friends = new Set([2]);
  const preview = (buildings: BuildingSnapshot[], tile = at(65, 10)) =>
    airliftPreview(DEFAULT_RULES, map, airport, me, owner, friends, 100, tile, 50, buildings);

  it("warns how many planes the hostile SAMs on the route would shoot down", () => {
    expect(preview([])).toMatchObject({ problem: null, planesLost: 0, planes: 4 });
    const hostile = building({ id: 2, owner: 3, tile: at(40, 12), level: 2, targetLevel: 2 });
    expect(preview([hostile]).planesLost).toBe(2);
    // A friend's SAM doesn't shoot; a reloading one has fewer ready.
    expect(preview([building({ id: 3, owner: 2, tile: at(40, 12) })]).planesLost).toBe(0);
    expect(preview([{ ...hostile, reloads: [150] }]).planesLost).toBe(1);
    // At most every plane.
    const wall = [2, 3, 4].map((id) =>
      building({ id, owner: 3, tile: at(30 + id * 3, 10), level: 3, targetLevel: 3 }),
    );
    expect(preview(wall).planesLost).toBe(4);
  });

  it("knows whose SAMs are hostile: everyone's but ours and our friends'", () => {
    expect(isHostile(3, 1, friends)).toBe(true);
    expect(isHostile(2, 1, friends)).toBe(false);
    expect(isHostile(1, 1, friends)).toBe(false);
  });
});

describe("SAM toasts", () => {
  const shot = (owner: number, by: number, planesLeft = 3): SimEvent => ({
    type: "flightIntercepted",
    flightId: 1,
    owner,
    by,
    tile: at(40, 10),
    fromTile: at(40, 12),
    weapon: "sam",
    planes: 1,
    planesLeft,
    troopsLost: 2_500,
  });
  const names = (id: number) => `P${id}`;

  it("tell us when our planes are shot down, and when our SAM hits", () => {
    expect(toastsForEvents([shot(1, 3)], 1, names)).toEqual([
      {
        text: "💥 P3's SAM shot down one of your planes (−2.5K troops)",
        tone: "danger",
        player: 3,
      },
    ]);
    expect(toastsForEvents([shot(1, 3, 0)], 1, names)[0]!.text).toBe(
      "💥 P3's SAMs shot down your last plane (−2.5K troops)",
    );
    expect(toastsForEvents([shot(3, 1)], 1, names)).toEqual([
      { text: "🎯 Your SAM shot down one of P3's planes", tone: "success", player: 3 },
    ]);
    expect(toastsForEvents([shot(2, 3)], 1, names)).toEqual([]);
  });
});
