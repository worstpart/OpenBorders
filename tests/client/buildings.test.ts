/** The HUD's building logic (GAME_DESIGN.md §3.17). */
import { describe, expect, it } from "vitest";
import {
  buildBarItems,
  buildingAtPoint,
  buildingCard,
  buildOptions,
  wallAtPoint,
  wallCard,
  wallPreview,
  effectLines,
  upgradeLines,
  type BuildContext,
} from "../../src/client/app/buildings.ts";
import { HintTracker } from "../../src/client/app/hints.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { BuildingSnapshot, PlayerSnapshot, WallSnapshot } from "../../src/sim/frame.ts";
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
  walls: [],
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
      ["port", "Port", 50_000, "notCoast"], // an all-land test map: no coast anywhere
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

/** A finished wall of player 1 along row 2, x 2..8. */
function wall(overrides: Partial<WallSnapshot> = {}): WallSnapshot {
  return {
    id: 4,
    owner: 1,
    points: [at(2, 2), at(8, 2)],
    tiles: [2, 3, 4, 5, 6, 7, 8].map((x) => at(x, 2)),
    level: 1,
    targetLevel: 1,
    startTick: -1,
    readyTick: -1,
    ...overrides,
  };
}

describe("walls in the HUD (GAME_DESIGN.md §3.17.6)", () => {
  it("the build bar offers the wall tool, priced per tile", () => {
    const item = buildBarItems(ctx()).at(-1)!;
    expect(item).toMatchObject({ type: "wall", name: "Wall", unit: "/tile" });
    expect(item.price).toBe(DEFAULT_RULES.walls.levels[0].costPerTile);
  });

  it("previews the line through the points and the mouse, its length and price", () => {
    const preview = wallPreview(ctx(), [at(2, 5)], at(6, 5))!;
    expect(preview.points).toEqual([at(2, 5), at(6, 5)]);
    expect(preview.newTiles).toBe(5);
    expect(preview.price).toBe(3_000);
    expect(preview.problem).toBeNull();
    // Into their land, or through a building: refused, with the reason.
    expect(wallPreview(ctx(), [at(10, 5)], at(17, 5))!.problem).toBe("notYourLand");
    const blocked = ctx({ buildings: [building({ tile: at(4, 5) })] });
    expect(wallPreview(blocked, [at(2, 5)], at(6, 5))!.problem).toBe("building");
    // Joining a standing wall builds only the new tiles.
    expect(wallPreview(ctx({ walls: [wall()] }), [at(5, 0)], at(5, 4))!.newTiles).toBe(4);
    expect(wallPreview(ctx({ me: me({ gold: 0 }) }), [at(2, 5)], at(6, 5))!.problem).toBe("noGold");
  });

  it("a wall card shows its length, effect and upgrade; clicks find the wall", () => {
    const card = wallCard(ctx(), wall());
    expect(card).toMatchObject({ type: "wall", name: "Palisade", level: 1, mine: true });
    expect(card.effects[0]).toBe("7 tiles standing");
    expect(card.upgrade).toMatchObject({ name: "Stone Wall" });
    expect(wallAtPoint([wall()], WIDTH, 5.4, 2.6, 0.75)?.id).toBe(4);
    expect(wallAtPoint([wall()], WIDTH, 5.4, 4.6, 0.75)).toBeNull();
  });

  it("keeps buildings off walls", () => {
    expect(buildOptions(ctx({ walls: [wall()] }), at(5, 2))[0]!.blocked).toBe("wall");
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

describe("wall drawing", () => {
  it("splits a broken wall into runs, so the gap shows", async () => {
    const { wallRuns } = await import("../../src/client/render/buildings.ts");
    const row = [2, 3, 4, 5, 6, 7, 8].map((x) => at(x, 2));
    expect(wallRuns(row, WIDTH)).toEqual([row]);
    const broken = row.filter((t) => t !== at(5, 2));
    expect(wallRuns(broken, WIDTH)).toEqual([row.slice(0, 3), row.slice(4)]);
    // A diagonal step is still one run (8-connected).
    expect(wallRuns([at(2, 2), at(3, 3), at(4, 4)], WIDTH)).toHaveLength(1);
  });
});
