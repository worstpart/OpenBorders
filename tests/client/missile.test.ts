/** Missiles in the HUD and explosion particles (GAME_DESIGN.md §3.17.8, milestone 2B.5). */
import { describe, expect, it } from "vitest";
import {
  buildingCard,
  effectLines,
  upgradeLines,
  type BuildContext,
} from "../../src/client/app/buildings.ts";
import {
  airliftPreview,
  flightSprite,
  liftProblemText,
  missileEffectText,
} from "../../src/client/app/flights.ts";
import { incomingThreats } from "../../src/client/app/threats.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import { MAX_PARTICLES, ParticleSystem } from "../../src/client/render/particles.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import type { BuildingSnapshot, FlightSnapshot, PlayerSnapshot } from "../../src/sim/frame.ts";
import { createMap, Terrain } from "../../src/sim/map/gameMap.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";

const WIDTH = 100;
const HEIGHT = 50;
const map = createMap(WIDTH, HEIGHT, new Uint8Array(WIDTH * HEIGHT).fill(Terrain.Plains));
const at = (x: number, y: number) => y * WIDTH + x;
// Player 1 on the left, enemy 3 in the middle, ally 2 on the right.
const owner = new Uint16Array(WIDTH * HEIGHT).map((_, t) => {
  const x = t % WIDTH;
  return x < 20 ? 1 : x >= 80 ? 2 : 3;
});
const me = { id: 1, homeTroops: 50_000, capacity: 100_000, gold: 1_000_000 } as PlayerSnapshot;
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

const silo = (level: number, overrides: Partial<BuildingSnapshot> = {}) =>
  building("silo", 1, at(10, 25), level, overrides);

const aim = (
  mode: "missile" | "buster" | "warhead",
  tile: number,
  buildings: BuildingSnapshot[] = [],
  from = silo(3),
  player = me,
) =>
  airliftPreview(
    DEFAULT_RULES,
    map,
    from,
    player,
    owner,
    friends,
    100,
    tile,
    50,
    [from, ...buildings],
    mode,
    new Set(),
  );

describe("aiming a missile", () => {
  it("a strike missile: the enemy buildings within 8 km, its price and flight time", () => {
    const p = aim("missile", at(50, 25), [
      building("factory", 3, at(52, 25), 2),
      building("housing", 3, at(58, 25), 1), // exactly 8 km
      building("housing", 3, at(59, 25), 1),
    ]);
    expect(p).toMatchObject({ problem: null, cost: 75_000, planes: 1, planesLost: 0 });
    expect(p.seconds).toBe(Math.ceil(40 / 3) / 10);
    expect(p.missile).toMatchObject({ kind: "missile", buildings: 2, radius: 8 });
    expect(missileEffectText(DEFAULT_RULES, p.missile!)).toBe(
      "2 buildings −2 levels · 10% of their troops · suppress 8 km for 30 s",
    );
  });

  it("a bunker buster needs a building; a warhead counts the land it scorches and allies hit", () => {
    const p = aim("buster", at(50, 25));
    expect(liftProblemText("buster", p.problem!)).toBe(
      "a bunker buster needs an enemy building to hit",
    );
    const hit = aim("buster", at(50, 25), [building("housing", 3, at(50, 25), 3)]);
    expect(missileEffectText(DEFAULT_RULES, hit.missile!)).toBe(
      "destroy Metropolis · 5% of their troops",
    );
    const warhead = aim("warhead", at(70, 25));
    // Radius 20 from x = 70: x 50..90; the ally's land from x = 80 is hit, ours (x < 20) isn't.
    expect(warhead.missile).toMatchObject({ kind: "warhead", allies: [2] });
    expect(warhead.range).toBe(Infinity);
    const safe = aim("warhead", at(40, 25));
    expect(safe.missile).toMatchObject({ allies: [] });
    expect(missileEffectText(DEFAULT_RULES, safe.missile!)).toMatch(
      /^scorch [\d,]+ tiles of land$/,
    );
  });

  it("says why it can't fire: level, gold, reloading, range, own land", () => {
    const text = (p: ReturnType<typeof aim>) => liftProblemText(p.mode, p.problem!);
    expect(text(aim("warhead", at(50, 25), [], silo(2)))).toBe(
      "the strategic warhead needs a Strategic Missile Complex (level III)",
    );
    expect(text(aim("missile", at(50, 25), [], silo(1), { ...me, gold: 1_000 }))).toBe(
      "not enough gold",
    );
    expect(text(aim("missile", at(50, 25), [], silo(1, { reloads: [500] })))).toBe(
      "no missile ready — the Silo is reloading",
    );
    expect(text(aim("missile", at(5, 5), [], silo(1)))).toBe(
      "missiles hit an enemy's land or buildings",
    );
  });

  it("warns when a SAM that can stop it is on the route — a SAM I can't", () => {
    expect(aim("missile", at(50, 25), [building("sam", 3, at(40, 25), 1)]).planesLost).toBe(0);
    expect(aim("missile", at(50, 25), [building("sam", 3, at(40, 25), 2)]).planesLost).toBe(1);
    expect(aim("warhead", at(50, 25), [building("sam", 3, at(40, 25), 2)]).planesLost).toBe(0);
    expect(aim("warhead", at(50, 25), [building("sam", 3, at(40, 25), 3)]).planesLost).toBe(1);
  });
});

describe("the Silo's card and texts", () => {
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

  it("shows its missiles, what it fires and the warhead's cooldown", () => {
    const card = buildingCard(ctx, silo(3, { reloads: [150], cooldowns: [400] }));
    expect(card.silo).toMatchObject({
      ready: 2,
      max: 3,
      secondsToNext: 5,
      range: Infinity,
      buster: true,
      warheadSecondsLeft: 30,
      missileCost: 75_000,
      warheadCost: 500_000,
    });
    expect(buildingCard(ctx, silo(1)).silo).toMatchObject({
      buster: false,
      warheadSecondsLeft: null,
    });
    // Someone else's Silo: no buttons.
    expect(buildingCard(ctx, building("silo", 3, at(50, 25), 1)).silo).toBeNull();
  });

  it("names the levels: range, slots, bunker buster, warhead; Factory III's war production", () => {
    expect(effectLines(DEFAULT_RULES, "silo", 1)).toEqual([
      "Strike missile (75K): every enemy building within 8 km loses 2 levels, and 10% of their troops die",
      "1 missile, each reloads in 30 s",
      "Range 250 km",
    ]);
    expect(upgradeLines(DEFAULT_RULES, "silo", 2)).toContain("Range: the whole map");
    expect(upgradeLines(DEFAULT_RULES, "silo", 1)).toContain(
      "New: bunker buster — destroys one enemy building, and 5% of its owner's troops die",
    );
    expect(upgradeLines(DEFAULT_RULES, "factory", 2)).toContain(
      "New: war production — Airports and Silos within 60 km reload 25% faster",
    );
  });

  it("missiles fly the second sheet's art", () => {
    expect(flightSprite("missile")).toBe("missile");
    expect(flightSprite("buster")).toBe("airToGroundMissile");
    expect(flightSprite("warhead")).toBe("icbm");
  });
});

describe("missile toasts and threats", () => {
  const nameOf = (id: number) => `P${id}`;
  const hit = (owner: number): SimEvent[] => [
    {
      type: "flightArrived",
      flightId: 7,
      owner,
      kind: "missile",
      tile: at(50, 25),
      target: 3,
      planes: 1,
      troops: 0,
    },
    {
      type: "buildingStruck",
      buildingId: 1,
      playerId: 1,
      by: owner,
      buildingType: "factory",
      tile: at(50, 25),
      levelBefore: 2,
      level: 1,
      disabledUntil: 300,
    },
    {
      type: "missileHit",
      flightId: 7,
      owner,
      missile: "missile",
      tile: at(50, 25),
      victim: 1,
      buildings: 1,
      troops: 1_200,
    },
  ];

  it("one toast per missile, not one per building", () => {
    expect(toastsForEvents(hit(3), 1, nameOf).map((t) => t.text)).toEqual([
      "🚀 P3's strike missile hit 1 of your buildings (−2 levels) · 1.2K troops killed",
    ]);
    expect(toastsForEvents(hit(1), 1, nameOf).map((t) => t.text)).toEqual([
      "🚀 Your strike missile hit 1 building: −2 levels each · 1.2K troops killed",
    ]);
  });

  it("a warhead is news for everyone; the victim hears what it cost", () => {
    const blast: SimEvent = {
      type: "warheadDetonated",
      flightId: 8,
      owner: 3,
      tile: at(50, 25),
      radius: 20,
      tiles: 1_257,
      buildings: 0,
      victims: [{ id: 2, tiles: 1_257, troops: 20_000 }],
      untilTick: 700,
    };
    expect(toastsForEvents([blast], 2, nameOf)[0]!.text).toBe(
      "☢ P3's strategic warhead scorched 1,257 tiles of your land (−20K troops)",
    );
    expect(toastsForEvents([blast], 1, nameOf)[0]!.text).toBe("☢ P3's strategic warhead struck P2");
  });

  const flight = (overrides: Partial<FlightSnapshot>): FlightSnapshot => ({
    id: 1,
    owner: 3,
    kind: "warhead",
    source: -1,
    target: 3,
    fromTile: at(60, 10),
    toTile: at(30, 25),
    planes: 1,
    escorts: 0,
    troops: 0,
    launchTick: 0,
    arriveTick: 100,
    ...overrides,
  });
  const threats = (flights: FlightSnapshot[], buildings: BuildingSnapshot[] = []) =>
    incomingThreats({
      rules: DEFAULT_RULES,
      owner,
      boats: [],
      flights,
      buildings,
      friends,
      me: 1,
      tick: 0,
      width: WIDTH,
    });

  it("a warhead whose blast reaches our land is a threat, even aimed next door", () => {
    expect(threats([flight({})])).toMatchObject([{ kind: "missile", warning: false }]);
    expect(threats([flight({ toTile: at(50, 25) })])).toEqual([]);
    expect(threats([flight({ kind: "missile", toTile: at(30, 25) })])).toEqual([]);
  });

  it("a SAM III warns of every hostile launch within twice its radius", () => {
    const far = flight({ kind: "missile", toTile: at(70, 40), fromTile: at(60, 10) });
    expect(threats([far])).toEqual([]);
    const sam = building("sam", 1, at(15, 10), 3); // 45 km radius: warns within 90 km
    expect(threats([far], [sam])).toMatchObject([{ kind: "missile", warning: true }]);
    expect(threats([far], [{ ...sam, level: 2, targetLevel: 2 }])).toEqual([]);
  });
});

describe("explosion particles", () => {
  /** A canvas context that only counts what is drawn. */
  const fakeContext = () => {
    let draws = 0;
    const ctx = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "draws") return draws;
          if (key === "createRadialGradient") return () => ({ addColorStop: () => {} });
          if (key === "arc" || key === "fillRect" || key === "lineTo") return () => draws++;
          return () => {};
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D & { draws: number };
    return ctx;
  };
  const toScreen = (x: number, y: number) => ({ x: x * 4, y: y * 4 });

  it("bigger explosions throw out more; everything fades and is forgotten", () => {
    const small = new ParticleSystem();
    small.explode("intercept", 10, 10, 0);
    const big = new ParticleSystem();
    big.explode("warhead", 10, 10, 0);
    expect(big.count).toBeGreaterThan(small.count * 5);
    const ctx = fakeContext();
    big.draw(ctx, toScreen, 4, 300, 800, 600);
    expect(ctx.draws).toBeGreaterThan(0);
    expect(big.active).toBe(true);
    big.draw(ctx, toScreen, 4, 60_000, 800, 600);
    expect(big.active).toBe(false);
  });

  it("a delayed burst waits (a SAM's streak reaches the plane first), and the count is capped", () => {
    const system = new ParticleSystem();
    system.explode("intercept", 10, 10, 0, 280);
    const ctx = fakeContext();
    system.draw(ctx, toScreen, 4, 100, 800, 600);
    expect(ctx.draws).toBe(0);
    expect(system.active).toBe(true);
    for (let k = 0; k < 40; k++) system.explode("warhead", 10, 10, 0);
    expect(system.count).toBe(MAX_PARTICLES);
  });
});
