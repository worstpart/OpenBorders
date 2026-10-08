/** Airborne assaults and flak in the HUD (GAME_DESIGN.md §3.17.7, milestone 2B.3). */
import { describe, expect, it } from "vitest";
import {
  buildingCard,
  effectLines,
  upgradeLines,
  wallLines,
  type BuildContext,
} from "../../src/client/app/buildings.ts";
import {
  airliftPreview,
  FLIGHT_INFO,
  flightSprite,
  liftProblemText,
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
// Player 1 on the left, enemy 3 in the middle, friend 2 on the right; a neutral strip at x 50.
const owner = new Uint16Array(WIDTH * HEIGHT).map((_, t) => {
  const x = t % WIDTH;
  return x < 20 ? 1 : x >= 60 ? 2 : x === 50 ? 0 : 3;
});
const me = { id: 1, homeTroops: 50_000, capacity: 100_000, gold: 0 } as PlayerSnapshot;
const friends = new Set([2]);

function airport(level: number, overrides: Partial<BuildingSnapshot> = {}): BuildingSnapshot {
  return {
    id: 9,
    type: "airport",
    owner: 1,
    tile: at(10, 10),
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

describe("Military Airport card", () => {
  it("offers the airborne assault from level II, sharing the lift and its cooldown", () => {
    expect(buildingCard(ctx, airport(1)).airlift).toMatchObject({ assault: false });
    expect(buildingCard(ctx, airport(2)).airlift).toEqual({
      capacity: 15_000,
      secondsLeft: 0,
      assault: true,
      strikeSecondsLeft: null,
    });
    expect(buildingCard(ctx, airport(2, { cooldowns: [150] })).airlift?.secondsLeft).toBe(5);
    expect(buildingCard(ctx, airport(2)).laterLevel).toBeNull();
  });

  it("says what level II adds", () => {
    expect(upgradeLines(DEFAULT_RULES, "airport", 1)).toEqual([
      "Lifts up to 15% of your troop capacity",
      "Range 300 km, ready every 25 s",
      "New: airborne assault — land troops on an enemy's land",
    ]);
    expect(effectLines(DEFAULT_RULES, "airport", 2)).toContain(
      "To friends — or enemies (airborne assault) — within 300 km",
    );
  });

  it("Fortress Walls tell about their flak; lower levels don't have it", () => {
    expect(wallLines(DEFAULT_RULES, 3).at(-1)).toBe(
      "Flak: enemy planes flying within 3 km of it lose one plane",
    );
    expect(wallLines(DEFAULT_RULES, 2).join(" ")).not.toMatch(/Flak/);
  });
});

describe("assault preview", () => {
  const preview = (tile: number, level = 2) =>
    airliftPreview(
      DEFAULT_RULES,
      map,
      airport(level),
      me,
      owner,
      friends,
      100,
      tile,
      50,
      [],
      "assault",
    );

  it("goes to an enemy's land in range, carrying the send share capped by the lift", () => {
    expect(preview(at(40, 10))).toMatchObject({
      mode: "assault",
      problem: null,
      troops: 15_000,
      planes: 4,
    });
  });

  it("says why it can't go: friends', own or neutral land, or an Airport I", () => {
    const why = (tile: number, level = 2) => {
      const p = preview(tile, level);
      return p.problem ? liftProblemText(p.mode, p.problem) : null;
    };
    expect(why(at(65, 10))).toBe("assaults land on an enemy's land");
    expect(why(at(5, 5))).toBe("assaults land on an enemy's land");
    expect(why(at(50, 5))).toBe("assaults land on an enemy's land");
    expect(why(at(40, 10), 1)).toBe("an airborne assault needs a Military Airport (level II)");
    // The airlift mode keeps its own words.
    const lift = airliftPreview(
      DEFAULT_RULES,
      map,
      airport(2),
      me,
      owner,
      friends,
      100,
      at(40, 10),
      50,
    );
    expect(lift.problem && liftProblemText(lift.mode, lift.problem)).toBe(
      "airlifts go to an ally's or teammate's land",
    );
  });

  it("assaults fly helicopters and count as threats", () => {
    expect(flightSprite("assault")).toBe("helicopter");
    expect(flightSprite("airlift")).toBe("plane");
    expect(FLIGHT_INFO.assault).toMatchObject({ hostile: true, name: "airborne assault" });
  });
});

describe("assault and flak toasts", () => {
  const names = (id: number) => `P${id}`;
  const landed = (attackId: number): SimEvent => ({
    type: "assaultLanded",
    flightId: 1,
    owner: 1,
    target: 3,
    tile: at(40, 10),
    troops: 15_000,
    attackId,
  });

  it("tell the sender where it landed, and the target that troops came by air", () => {
    expect(toastsForEvents([landed(4)], 1, names)).toEqual([
      { text: "🪂 Assault landed: 15K troops attack P3", tone: "success", player: 3 },
    ]);
    expect(toastsForEvents([landed(-1)], 1, names)[0]).toMatchObject({ tone: "info" });
    expect(
      toastsForEvents(
        [
          {
            type: "attackStarted",
            attackId: 4,
            attacker: 1,
            target: 3,
            landingTile: at(40, 10),
            airborne: true,
          },
        ],
        3,
        names,
      ),
    ).toEqual([{ text: "🪂 P1's airborne troops landed on your land", tone: "danger", player: 1 }]);
  });

  it("name the wall's flak instead of a SAM", () => {
    const flak = (owner: number, by: number): SimEvent => ({
      type: "flightIntercepted",
      flightId: 1,
      owner,
      by,
      tile: at(40, 10),
      fromTile: at(41, 10),
      weapon: "flak",
      planes: 1,
      escorts: 0,
      planesLeft: 3,
      troopsLost: 3_750,
    });
    expect(toastsForEvents([flak(1, 3)], 1, names)[0]!.text).toBe(
      "💥 P3's Fortress Wall flak shot down one of your planes (−3.75K troops)",
    );
    expect(toastsForEvents([flak(3, 1)], 1, names)[0]!.text).toBe(
      "🎯 Your Fortress Wall flak shot down one of P3's planes",
    );
  });
});
