/** The HUD's building logic (GAME_DESIGN.md §3.17). */
import { describe, expect, it } from "vitest";
import {
  buildingAtPoint,
  buildingCard,
  buildOptions,
  effectLines,
  upgradeLines,
  type BuildContext,
} from "../../src/client/app/buildings.ts";
import { HintTracker } from "../../src/client/app/hints.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { BuildingSnapshot, PlayerSnapshot } from "../../src/sim/frame.ts";
import { createMap, Terrain } from "../../src/sim/map/gameMap.ts";
import { DEFAULT_RULES, makeRules } from "../../src/sim/rules.ts";

const WIDTH = 20;
const HEIGHT = 10;
const map = createMap(WIDTH, HEIGHT, new Uint8Array(WIDTH * HEIGHT).fill(Terrain.Plains));
const owner = new Uint16Array(WIDTH * HEIGHT).fill(1);
for (let y = 0; y < HEIGHT; y++) for (let x = 15; x < WIDTH; x++) owner[y * WIDTH + x] = 2;
const at = (x: number, y: number) => y * WIDTH + x;

function me(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 1,
    name: "You",
    kind: "human",
    alive: true,
    spawned: true,
    ready: true,
    tiles: 150,
    homeTroops: 10_000,
    fieldTroops: 0,
    capacity: 100_000,
    growthPerTick: 0,
    gold: 100_000,
    goldPerTick: 20,
    mobilizeDiscount: 0,
    growthBonus: 0,
    peakTiles: 150,
    tier: null,
    personality: null,
    difficulty: null,
    eliminatedTick: -1,
    traitorUntilTick: -1,
    betrayals: 0,
    team: 0,
    neighbors: [2],
    ...overrides,
  };
}

function building(overrides: Partial<BuildingSnapshot> = {}): BuildingSnapshot {
  return {
    id: 1,
    type: "housing",
    owner: 1,
    tile: at(3, 3),
    level: 1,
    targetLevel: 1,
    startTick: -1,
    readyTick: -1,
    ...overrides,
  };
}

const ctx = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  rules: DEFAULT_RULES,
  map,
  owner,
  buildings: [],
  me: me(),
  tick: 100,
  playing: true,
  ...overrides,
});

describe("build options", () => {
  it("list every building with its price on our land", () => {
    const options = buildOptions(ctx(), at(5, 5));
    expect(options.map((o) => [o.type, o.name, o.price, o.blocked])).toEqual([
      ["housing", "Housing", 40_000, null],
      ["factory", "Factory", 60_000, null],
    ]);
  });

  it("say why one can't be built", () => {
    expect(buildOptions(ctx({ me: me({ gold: 50_000 }) }), at(5, 5))[1]!.blocked).toBe("noGold");
    expect(buildOptions(ctx({ buildings: [building()] }), at(5, 5))[0]!.blocked).toBe("tooClose");
    expect(buildOptions(ctx({ playing: false }), at(5, 5))[0]!.blocked).toBe("notPlaying");
    expect(buildOptions(ctx(), at(17, 5))).toEqual([]); // their land
    const off = makeRules({ buildings: { enabled: false } });
    expect(buildOptions(ctx({ rules: off }), at(5, 5))).toEqual([]);
  });

  it("price in the levels we already own", () => {
    const owned = [building({ level: 2, targetLevel: 2, tile: at(0, 0) })];
    expect(buildOptions(ctx({ buildings: owned }), at(12, 8))[0]!.price).toBe(60_000);
  });
});

describe("building card", () => {
  it("shows what it gives and the next level", () => {
    const housing = building();
    const card = buildingCard(ctx({ buildings: [housing] }), housing);
    expect(card.name).toBe("Housing");
    expect(card.effects).toEqual(["+30K troop capacity"]);
    expect(card.upgrade).toMatchObject({ name: "Developed Housing", price: 113_000 });
    expect(card.upgrade!.lines).toEqual(["Troop capacity +90K", "New: +5% troop growth"]);
    expect(card.upgrade!.affordable).toBe(false);
  });

  it("shows construction progress and no upgrade meanwhile", () => {
    const card = buildingCard(
      ctx(),
      building({ level: 0, targetLevel: 1, startTick: 80, readyTick: 130 }),
    );
    expect(card.work).toEqual({ level: 1, secondsLeft: 3, progress: 0.4 });
    expect(card.upgrade).toBeNull();
    expect(card.name).toBe("Housing");
  });

  it("offers nothing on someone else's building or at level III", () => {
    expect(buildingCard(ctx(), building({ owner: 2 })).upgrade).toBeNull();
    expect(buildingCard(ctx(), building({ level: 3, targetLevel: 3 })).upgrade).toBeNull();
  });

  it("describes every level", () => {
    expect(effectLines(DEFAULT_RULES, "factory", 2)).toEqual([
      "+900 gold/s",
      "Mobilize 10% cheaper",
    ]);
    expect(upgradeLines(DEFAULT_RULES, "housing", 2)).toEqual([
      "Troop capacity +250K",
      "+10% troop growth",
      "New: gold +200/s",
    ]);
  });
});

describe("clicks on buildings", () => {
  it("hit the nearest icon within the radius", () => {
    const list = [building({ id: 1, tile: at(3, 3) }), building({ id: 2, tile: at(6, 3) })];
    expect(buildingAtPoint(list, WIDTH, 3.6, 3.4, 1)?.id).toBe(1);
    expect(buildingAtPoint(list, WIDTH, 6.2, 3.9, 1)?.id).toBe(2);
    expect(buildingAtPoint(list, WIDTH, 5, 8, 1)).toBeNull();
  });
});

describe("building toasts and hint", () => {
  const names = (id: number) => `P${id}`;

  it("announce finished buildings, captures and losses", () => {
    const toasts = toastsForEvents(
      [
        {
          type: "buildingCompleted",
          buildingId: 1,
          playerId: 1,
          buildingType: "housing",
          tile: 0,
          level: 2,
        },
        {
          type: "buildingCaptured",
          buildingId: 2,
          from: 1,
          to: 3,
          buildingType: "factory",
          tile: 0,
          level: 1,
        },
        {
          type: "buildingDestroyed",
          buildingId: 3,
          playerId: 4,
          buildingType: "housing",
          tile: 0,
          by: 1,
          reason: "captured",
        },
        {
          type: "buildingCompleted",
          buildingId: 4,
          playerId: 5,
          buildingType: "housing",
          tile: 0,
          level: 1,
        },
      ],
      1,
      names,
    );
    expect(toasts.map((t) => t.text)).toEqual([
      "Developed Housing ready — +90K troop capacity, +5% troop growth",
      "P3 took over your Factory",
      "You destroyed P4's Housing",
    ]);
  });

  it("suggests building once Housing is affordable", () => {
    const hints = new HintTracker(null);
    for (const id of ["expand", "sweetSpot", "menus", "gold"] as const) hints.complete(id);
    expect(hints.update({ playing: true, canAttackPlayer: false }, 0)).toBeNull();
    expect(hints.update({ playing: true, canAttackPlayer: false, canBuild: true }, 1)).toBe(
      "build",
    );
  });
});
