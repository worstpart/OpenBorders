/** The HUD's boat logic (GAME_DESIGN.md §3.18). */
import { describe, expect, it } from "vitest";
import {
  boatChips,
  boatPosition,
  boatPreview,
  needsBoat,
  type BoatContext,
} from "../../src/client/app/boats.ts";
import { toastsForEvents } from "../../src/client/app/toasts.ts";
import type { BoatSnapshot, PlayerSnapshot } from "../../src/sim/frame.ts";
import { createMap } from "../../src/sim/map/gameMap.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";
import { parseAscii } from "../helpers/asciiMap.ts";

// Two islands; player 1 also borders player 3 by land.
const parsed = parseAscii(`
  ~~~~~~~~~~~~~~~~~~~~
  ~1133~~~~~~~~~~2222~
  ~1133~~~~~~~~~~2222~
  ~1133~~~~~~~~~~2222~
  ~~~~~~~~~~~~~~~~~~~~
`);
const WIDTH = 20;
const at = (x: number, y: number) => y * WIDTH + x;
const map = createMap(parsed.width, parsed.height, parsed.terrain);

function me(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: 1,
    name: "You",
    kind: "human",
    alive: true,
    spawned: true,
    ready: true,
    tiles: 6,
    homeTroops: 10_000,
    fieldTroops: 0,
    capacity: 100_000,
    growthPerTick: 0,
    gold: 0,
    goldPerTick: 0,
    mobilizeDiscount: 0,
    growthBonus: 0,
    peakTiles: 6,
    tier: null,
    personality: null,
    difficulty: null,
    eliminatedTick: -1,
    traitorUntilTick: -1,
    betrayals: 0,
    team: 0,
    neighbors: [0, 3],
    ...overrides,
  };
}

function boat(overrides: Partial<BoatSnapshot> = {}): BoatSnapshot {
  return {
    id: 1,
    owner: 1,
    target: 2,
    troops: 2_000,
    launchTile: at(3, 2),
    landingTile: at(15, 2),
    focusTile: at(16, 2),
    route: Int32Array.from([5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((x) => at(x, 2))),
    launchTick: 100,
    tilesPerTick: 1,
    arriveTick: 111,
    recallTick: -1,
    ...overrides,
  };
}

const ctx = (overrides: Partial<BoatContext> = {}): BoatContext => ({
  rules: DEFAULT_RULES,
  map,
  owner: parsed.owners,
  buildings: [],
  boats: [],
  me: me(),
  tick: 105,
  playing: true,
  ...overrides,
});

describe("boats in the HUD", () => {
  it("send a boat only where we can't reach over our border", () => {
    expect(needsBoat(ctx(), at(16, 2))).toBe(true); // across the sea
    expect(needsBoat(ctx(), at(3, 2))).toBe(false); // a land neighbour
    expect(needsBoat(ctx(), at(1, 2))).toBe(false); // our own land
    expect(needsBoat(ctx(), at(8, 2))).toBe(false); // water
  });

  it("preview the crossing: landing, route and seconds to land", () => {
    const preview = boatPreview(ctx(), at(15, 2))!;
    expect(preview.plan?.landingTile).toBe(at(15, 2));
    // We sail from our own coast (player 3's, next to us, isn't ours to use).
    expect(parsed.owners[preview.plan!.launchTile]).toBe(1);
    expect(preview.problem).toBeNull();
    expect(preview.seconds).toBeGreaterThan(1);
    const full = boatPreview(
      ctx({ boats: [boat({ id: 1 }), boat({ id: 2 }), boat({ id: 3 })] }),
      at(16, 2),
    )!;
    expect(full.problem).toBe("noBoat");
  });

  it("place a boat along its route, and back when recalled", () => {
    const b = boat();
    const start = boatPosition(b, WIDTH, 100);
    expect([start.x, start.y]).toEqual([3.5, 2.5]);
    const mid = boatPosition(b, WIDTH, 102.5);
    expect(mid.x).toBeCloseTo(7, 6); // halfway between route steps 2 and 3
    expect(mid.dx).toBeGreaterThan(0);
    const back = boatPosition(boat({ recallTick: 104, arriveTick: 108 }), WIDTH, 106);
    expect(back.x).toBeCloseTo(6.5, 6); // turned at step 4, two steps back
    expect(back.dx).toBeLessThan(0);
  });

  it("list our boats and the ones sailing for our coast", () => {
    const owner = parsed.owners.slice();
    const theirs = boat({ id: 2, owner: 2, target: 1, landingTile: at(2, 2) });
    owner[at(2, 2)] = 1;
    const chips = boatChips(
      ctx({ owner, boats: [boat(), theirs, boat({ id: 3, owner: 2, target: 3 })] }),
    );
    expect(chips.map((c) => [c.id, c.mine, c.other])).toEqual([
      [1, true, 2],
      [2, false, 2],
    ]);
    expect(chips[0]!.secondsLeft).toBeCloseTo(0.6, 6);
  });

  it("warn about incoming boats and landings", () => {
    const name = (id: number) => `P${id}`;
    expect(
      toastsForEvents(
        [
          {
            type: "boatLaunched",
            boatId: 1,
            owner: 2,
            target: 1,
            troops: 5,
            landingTile: 0,
            arriveTick: 9,
          },
          { type: "attackStarted", attackId: 1, attacker: 2, target: 1, landingTile: at(2, 2) },
        ],
        1,
        name,
      ).map((t) => t.text),
    ).toEqual(["⛵ P2's boat is heading for your coast", "P2 landed on your coast"]);
  });
});
