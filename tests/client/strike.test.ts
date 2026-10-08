/** Air strikes, escorts and suppression in the HUD (GAME_DESIGN.md §3.17.7, milestone 2B.4). */
import { describe, expect, it } from "vitest";
import {
  buildingCard,
  effectLines,
  upgradeLines,
  type BuildContext,
} from "../../src/client/app/buildings.ts";
import {
  airliftPreview,
  FLIGHT_INFO,
  flightSprite,
  liftProblemText,
  strikeEffectText,
} from "../../src/client/app/flights.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import type { BuildingSnapshot, PlayerSnapshot } from "../../src/sim/frame.ts";
import { createMap, Terrain } from "../../src/sim/map/gameMap.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";

const WIDTH = 80;
const HEIGHT = 20;
const map = createMap(WIDTH, HEIGHT, new Uint8Array(WIDTH * HEIGHT).fill(Terrain.Plains));
const at = (x: number, y: number) => y * WIDTH + x;
// Player 1 on the left, enemy 3 in the middle, friend 2 on the right.
const owner = new Uint16Array(WIDTH * HEIGHT).map((_, t) => {
  const x = t % WIDTH;
  return x < 20 ? 1 : x >= 60 ? 2 : 3;
});
const me = { id: 1, homeTroops: 50_000, capacity: 100_000, gold: 0 } as PlayerSnapshot;
const friends = new Set([2]);

function building(
  type: BuildingSnapshot["type"],
  ownerId: number,
  tile: number,
  level: number,
  overrides: Partial<BuildingSnapshot> = {},
): BuildingSnapshot {
  return {
    id: tile,
    type,
    owner: ownerId,
    tile,
    level,
    targetLevel: level,
    startTick: -1,
    readyTick: -1,
    reloads: [],
    cooldowns: [],
    disabledUntil: -1,
    ...overrides,
  };
}

const AIR_BASE = building("airport", 1, at(10, 10), 3);

const ctx: BuildContext = {
  rules: DEFAULT_RULES,
  map,
  owner,
  buildings: [],
  walls: [],
  me,
  tick: 100,
  playing: true,
};

const strike = (tile: number, buildings: BuildingSnapshot[] = [], airport = AIR_BASE) =>
  airliftPreview(
    DEFAULT_RULES,
    map,
    airport,
    me,
    owner,
    friends,
    100,
    tile,
    50,
    buildings,
    "strike",
  );

describe("Air Base card", () => {
  it("offers the air strike on its own cooldown, beside the lifts", () => {
    expect(buildingCard(ctx, AIR_BASE).airlift).toEqual({
      capacity: 20_000,
      secondsLeft: 0,
      assault: true,
      strikeSecondsLeft: 0,
    });
    const cooling = building("airport", 1, at(10, 10), 3, { cooldowns: [-1, 130] });
    expect(buildingCard(ctx, cooling).airlift).toMatchObject({
      secondsLeft: 0,
      strikeSecondsLeft: 3,
    });
    expect(
      buildingCard(ctx, building("airport", 1, at(10, 10), 2)).airlift?.strikeSecondsLeft,
    ).toBe(null);
    expect(buildingCard(ctx, AIR_BASE).laterLevel).toBeNull();
  });

  it("says what level III adds, and shows a struck building's time out of action", () => {
    expect(upgradeLines(DEFAULT_RULES, "airport", 2)).toEqual([
      "Lifts up to 20% of your troop capacity",
      "Range 350 km, ready every 20 s",
      "New: air strikes — 4 fighters every 30 s: a building loses a level, or a point's defences are suppressed",
      "New: 2 escort fighters shield every lift from SAMs",
    ]);
    expect(effectLines(DEFAULT_RULES, "airport", 3)).toContain(
      "2 escort fighters guard every lift",
    );
    const struck = building("factory", 3, at(40, 10), 2, { disabledUntil: 150 });
    expect(buildingCard(ctx, struck).disabledSeconds).toBe(5);
    expect(buildingCard(ctx, AIR_BASE).disabledSeconds).toBe(0);
  });
});

describe("strike preview", () => {
  it("on an enemy building: what it loses, with fighters' flight time", () => {
    const factory = building("factory", 3, at(40, 10), 3);
    const p = strike(factory.tile, [factory]);
    expect(p).toMatchObject({ mode: "strike", problem: null, troops: 0, planes: 4, escorts: 0 });
    expect(p.strike).toMatchObject({ kind: "building", level: 3, levelAfter: 2 });
    expect(strikeEffectText(DEFAULT_RULES, p.strike!)).toBe("Mega Industrial Complex → level II");
    // Fighters: 3 tiles a tick, 30 tiles → 1 s.
    expect(p.seconds).toBe(1);
    const housing = building("housing", 3, at(40, 10), 1);
    expect(strikeEffectText(DEFAULT_RULES, strike(housing.tile, [housing]).strike!)).toBe(
      "destroy Housing",
    );
  });

  it("with SAMs over the target: fewer fighters through, maybe only out of action", () => {
    const factory = building("factory", 3, at(40, 10), 2);
    const sam = building("sam", 3, at(41, 10), 3);
    const p = strike(factory.tile, [factory, sam]);
    expect(p.planesLost).toBe(3);
    expect(strikeEffectText(DEFAULT_RULES, p.strike!)).toBe(
      "Industrial Complex out of action 20 s",
    );
  });

  it("on open enemy land: a suppression zone", () => {
    const p = strike(at(40, 5));
    expect(p.strike).toEqual({ kind: "point", radius: 10, seconds: 30 });
    expect(strikeEffectText(DEFAULT_RULES, p.strike!)).toBe("suppress 10 km for 30 s");
  });

  it("says why it can't go", () => {
    const why = (tile: number, airport = AIR_BASE) => {
      const p = strike(tile, [], airport);
      return p.problem ? liftProblemText(p.mode, p.problem) : null;
    };
    expect(why(at(65, 10))).toBe("air strikes hit an enemy's land or buildings");
    expect(why(at(5, 5))).toBe("air strikes hit an enemy's land or buildings");
    expect(why(at(40, 10), building("airport", 1, at(10, 10), 2))).toBe(
      "an air strike needs an Air Base (level III)",
    );
    expect(why(at(40, 10), building("airport", 1, at(10, 10), 3, { cooldowns: [-1, 200] }))).toBe(
      "the fighters are still on cooldown",
    );
    expect(why(at(40, 10), building("airport", 1, at(10, 10), 3, { disabledUntil: 200 }))).toBe(
      "the Airport was hit by an air strike",
    );
  });

  it("an Air Base's lifts count their escorts against the SAMs", () => {
    const sam = building("sam", 3, at(30, 10), 2); // two interceptors on the route
    const lift = airliftPreview(
      DEFAULT_RULES,
      map,
      AIR_BASE,
      me,
      owner,
      friends,
      100,
      at(40, 10),
      50,
      [sam],
      "assault",
    );
    expect(lift).toMatchObject({ escorts: 2, planesLost: 0 });
  });

  it("strikes fly fighters and count as threats", () => {
    expect(flightSprite("strike")).toBe("plane");
    expect(FLIGHT_INFO.strike).toMatchObject({ hostile: true, name: "air strike" });
  });
});

describe("strike toasts", () => {
  const names = (id: number) => `P${id}`;
  const hit = (levelBefore: number, level: number): SimEvent => ({
    type: "buildingStruck",
    buildingId: 4,
    playerId: 3,
    by: 1,
    buildingType: "factory",
    tile: at(40, 10),
    levelBefore,
    level,
    disabledUntil: level === 0 ? -1 : 300,
  });

  it("tell the striker and the victim what was hit", () => {
    expect(toastsForEvents([hit(3, 2)], 1, names)).toEqual([
      {
        text: "💥 Air strike hit P3's Mega Industrial Complex: down to level 2, out of action 20 s",
        tone: "success",
        player: 3,
      },
    ]);
    expect(toastsForEvents([hit(2, 2)], 3, names)[0]).toMatchObject({
      text: "💥 P1's air strike hit your Industrial Complex: out of action 20 s",
      tone: "danger",
    });
    expect(toastsForEvents([hit(1, 0)], 3, names)[0]!.text).toBe(
      "💥 P1's air strike hit your Factory: destroyed",
    );
  });

  it("tell both sides about a suppression, and an escort taking a shot", () => {
    const zone: SimEvent = {
      type: "suppressed",
      flightId: 2,
      by: 1,
      victim: 3,
      tile: at(40, 10),
      radius: 10,
      untilTick: 400,
    };
    expect(toastsForEvents([zone], 3, names)[0]).toMatchObject({ tone: "danger", player: 1 });
    expect(toastsForEvents([zone], 1, names)[0]!.text).toBe(
      "💥 Air strike: P3's walls there are down for 30 s — attack now",
    );
    const escort: SimEvent = {
      type: "flightIntercepted",
      flightId: 1,
      owner: 1,
      by: 3,
      tile: at(30, 10),
      fromTile: at(30, 11),
      weapon: "sam",
      planes: 0,
      escorts: 1,
      planesLeft: 4,
      troopsLost: 0,
    };
    expect(toastsForEvents([escort], 1, names)[0]!.text).toBe(
      "🛡 P3's SAM shot down an escort fighter — your planes fly on",
    );
  });
});
