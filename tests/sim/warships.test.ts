/** Naval Base (Port III) warships and coastal fortification (GAME_DESIGN §3.18.1, 2B.6, D-031). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { tileCost } from "../../src/sim/systems/attacks.ts";
import { coastFortLevel, maxLevel } from "../../src/sim/systems/buildings.ts";
import { patrolTiles, warshipTile } from "../../src/sim/systems/warships.ts";
import { runTick } from "../../src/sim/tick.ts";
import { Terrain } from "../../src/sim/map/gameMap.ts";
import { setOwner, type Attack, type Building, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

// 60 × 20: player 1 on the west island, player 4 (everyone's enemy) at its south end; on the
// east island player 2 (north) and player 1's teammate 3 (south).
const WIDTH = 60;
const HEIGHT = 20;
const MAP = Array.from({ length: HEIGHT }, (_, y) =>
  Array.from({ length: WIDTH }, (_, x) => {
    if (y === 0 || y === HEIGHT - 1) return "~";
    if (x >= 1 && x <= 8) return y >= 16 ? "4" : "1";
    if (x >= 51 && x <= 58) return y <= 9 ? "2" : "3";
    return "~";
  }).join(""),
).join("\n");
const at = (x: number, y: number) => y * WIDTH + x;
const BASE_1 = at(8, 9);
const SPEED = RULES.warships.tilesPerTick;

function port(w: World, owner: number, tile: number, level: number): Building {
  const b: Building = {
    id: w.nextBuildingId++,
    type: "port",
    owner,
    tile,
    level,
    targetLevel: level,
    startTick: -1,
    readyTick: -1,
    paid: 0,
    reloads: [],
    cooldowns: [],
    disabledUntil: -1,
  };
  w.buildings.push(b);
  w.buildingAt[tile] = b.id;
  return b;
}

function world(rules: GameRules = RULES): World {
  const w = worldFromAscii(MAP, {
    rules,
    homeTroops: [50_000, 50_000, 50_000, 50_000],
    teams: [1, 2, 1, 4],
  });
  for (const p of w.players) p.gold = 10_000_000;
  return w;
}

function step(w: World, commands: { playerId: number; command: Command }[] = []): SimEvent[] {
  return [...runTick(w, { tick: w.tick + 1, commands }).events];
}

function run(w: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) events.push(...step(w));
  return events;
}

function ofType<T extends SimEvent["type"]>(events: SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

const boat = (target: number, tile: number): Command => ({
  type: "boat",
  target,
  tile,
  percentBp: 1_000,
});

describe("a Naval Base", () => {
  it("puts its two warships to sea at once, and they patrol the water around it", () => {
    const w = world();
    port(w, 1, BASE_1, 3);
    const launched = ofType(step(w), "warshipLaunched");
    expect(launched).toHaveLength(2);
    expect(w.warships.map((s) => s.owner)).toEqual([1, 1]);
    const area = new Set(patrolTiles(w.map, BASE_1, 40));
    for (let k = 0; k < 30; k++) {
      run(w, 20);
      for (const ship of w.warships) {
        const tile = warshipTile(ship, SPEED, w.tick);
        expect(w.map.terrain[tile]).toBe(Terrain.Water);
        // Patrol legs end inside the area (a leg may cut across the area's edge in between).
        expect(area.has(ship.toTile)).toBe(true);
      }
    }
    // They really move.
    expect(new Set(w.warships.map((s) => s.toTile)).size).toBeGreaterThan(1);
  });

  it("is only offered with warships: without them a Port stops at level II", () => {
    expect(maxLevel(RULES, "port")).toBe(3);
    const off = makeRules({ warships: { enabled: false } });
    expect(maxLevel(off, "port")).toBe(2);
    const w = world(off);
    const b = port(w, 1, BASE_1, 2);
    const events = step(w, [{ playerId: 1, command: { type: "upgrade", buildingId: b.id } }]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "commandRejected", reason: "already at the top level" }),
    );
  });

  it("can be built by upgrading a Naval Port, and then launches its fleet", () => {
    const w = world();
    const b = port(w, 1, BASE_1, 2);
    step(w, [{ playerId: 1, command: { type: "upgrade", buildingId: b.id } }]);
    expect(w.warships).toHaveLength(0); // still upgrading
    const events = run(w, RULES.buildings.types.port.levels[2]!.buildTicks + 1);
    expect(b.level).toBe(3);
    expect(ofType(events, "warshipLaunched")).toHaveLength(2);
  });
});

describe("warships", () => {
  it("sink a hostile troop boat in their patrol area: everyone aboard is lost", () => {
    const w = world();
    port(w, 1, BASE_1, 3);
    step(w);
    const before = w.players[1]!.homeTroops;
    step(w, [{ playerId: 2, command: boat(1, at(4, 5)) }]);
    expect(w.boats).toHaveLength(1);
    const troops = w.boats[0]!.troops;
    expect(w.players[1]!.homeTroops).toBe(before - troops);
    const events = run(w, 60);
    const sunk = ofType(events, "boatSunk");
    expect(sunk).toHaveLength(1);
    expect(sunk[0]).toMatchObject({ owner: 2, target: 1, by: 1, troops });
    expect(ofType(events, "warshipFired")[0]).toMatchObject({
      owner: 1,
      victim: 2,
      targetKind: "boat",
      result: "sunk",
    });
    expect(ofType(events, "boatLanded")).toHaveLength(0);
    expect(w.boats).toHaveLength(0);
    expect(w.players[1]!.homeTroops).toBe(before - troops); // never came back
  });

  it("sink any non-friend's boat in the area, whoever it sails for; friends' boats pass", () => {
    const w = world();
    port(w, 1, BASE_1, 3);
    step(w);
    // Both sail for player 4's coast, past player 1's Base: the teammate's (3) lands, the
    // enemy's (2) is sunk.
    const events = [
      ...step(w, [
        { playerId: 3, command: boat(4, at(4, 18)) },
        { playerId: 2, command: boat(4, at(6, 18)) },
      ]),
      ...run(w, 80),
    ];
    expect(ofType(events, "boatLaunched").map((e) => e.owner)).toEqual([3, 2]);
    expect(ofType(events, "boatSunk").map((e) => e.owner)).toEqual([2]);
    expect(ofType(events, "boatLanded").map((e) => e.owner)).toEqual([3]);
  });

  it("leave allies' boats alone too", () => {
    const w = world();
    port(w, 1, BASE_1, 3);
    step(w, [{ playerId: 1, command: { type: "allianceRequest", target: 2 } }]);
    step(w, [{ playerId: 2, command: { type: "allianceReply", from: 1, accept: true } }]);
    expect(w.alliances.size).toBe(1);
    step(w, [{ playerId: 2, command: boat(4, at(6, 18)) }]);
    const events = run(w, 80);
    expect(ofType(events, "boatSunk")).toHaveLength(0);
    expect(ofType(events, "boatLanded").map((e) => e.owner)).toEqual([2]);
  });

  it("don't fire during spawn protection", () => {
    const w = world();
    port(w, 1, BASE_1, 3);
    step(w);
    step(w, [{ playerId: 2, command: boat(1, at(4, 5)) }]);
    // Spawn protection again (boats can't launch during it, but one already at sea is safe).
    w.playStartTick = w.tick;
    const events = run(w, 60);
    expect(ofType(events, "boatSunk")).toHaveLength(0);
  });

  it("capture a hostile trade ship passing by: it sails for the captor's Port, which gets the cargo", () => {
    const w = world();
    const base = port(w, 1, BASE_1, 3);
    port(w, 2, at(51, 5), 1);
    const port4 = port(w, 4, at(8, 17), 1);
    const events = run(w, 800);
    const captured = ofType(events, "tradeCaptured");
    expect(captured.length).toBeGreaterThan(0);
    for (const c of captured) {
      expect(c).toMatchObject({ by: 1, toPort: base.id });
      expect([2, 4]).toContain(c.from);
    }
    const prizes = ofType(events, "tradeDocked").filter((d) => d.captured);
    expect(prizes.length).toBeGreaterThan(0);
    for (const d of prizes) {
      expect(d).toMatchObject({ owner: 1, receiver: 1 });
      expect(d.gold).toBeGreaterThan(0);
    }
    const docked = ofType(events, "tradeDocked").filter((d) => !d.captured);
    // Ships between players 2 and 4 never got through player 1's waters…
    expect(docked.filter((d) => d.owner === 2 && d.toPort === port4.id)).toHaveLength(0);
    // …but those coming to trade with player 1 did, and player 1's own trade is untouched.
    expect(docked.some((d) => d.owner === 2 && d.toPort === base.id && d.receiver === 1)).toBe(
      true,
    );
    expect(docked.some((d) => d.owner === 4 && d.toPort === base.id)).toBe(true);
    expect(docked.some((d) => d.owner === 1)).toBe(true);
  });

  it("leave a teammate's trade ships alone", () => {
    const w = world();
    port(w, 1, BASE_1, 3);
    port(w, 3, at(51, 15), 1);
    const events = run(w, 600);
    expect(ofType(events, "tradeCaptured")).toHaveLength(0);
    expect(ofType(events, "tradeDocked").filter((d) => d.owner === 3).length).toBeGreaterThan(0);
  });

  it("fight hostile warships: the loser sinks and is rebuilt at its Base later", () => {
    const w = world();
    port(w, 1, BASE_1, 3);
    port(w, 2, at(51, 5), 3);
    const events = run(w, 1_500);
    const hits = ofType(events, "warshipFired").filter((e) => e.targetKind === "warship");
    expect(hits.length).toBeGreaterThan(0);
    const sunk = ofType(events, "warshipSunk").filter((e) => e.by !== 0);
    expect(sunk.length).toBeGreaterThan(0);
    const first = sunk[0]!;
    expect(first.readyTick).toBeGreaterThan(0);
    const back = ofType(events, "warshipLaunched").filter(
      (e) => e.warshipId === first.warshipId && e.owner === first.owner,
    );
    // Launched at the start, and again once rebuilt (if the game ran that long).
    if (first.readyTick < w.tick) expect(back.length).toBeGreaterThanOrEqual(2);
  });

  it("are scuttled when their Base changes hands; the new owner builds their own", () => {
    const w = world();
    const base = port(w, 1, BASE_1, 3);
    run(w, 10);
    setOwner(w, BASE_1, 2);
    const events = run(w, 5);
    expect(base.owner).toBe(2);
    expect(ofType(events, "warshipSunk")).toHaveLength(2);
    expect(w.warships.every((s) => s.owner === 2 && s.readyTick > 0)).toBe(true);
    const later = run(w, RULES.warships.rebuildTicks);
    expect(ofType(later, "warshipLaunched").map((e) => e.owner)).toEqual([2, 2]);
  });

  it("are gone with their Base", () => {
    const w = world();
    const base = port(w, 1, BASE_1, 3);
    run(w, 10);
    base.level = 2; // lost a level (strike, missile)
    base.targetLevel = 2;
    run(w, 2);
    expect(w.warships).toHaveLength(0);
  });

  it("are deterministic and hashed", () => {
    const a = world();
    const b = world();
    for (const w of [a, b]) {
      port(w, 1, BASE_1, 3);
      port(w, 2, at(51, 5), 3);
    }
    run(a, 400);
    run(b, 400);
    expect(hashWorld(a)).toBe(hashWorld(b));
    const h = hashWorld(a);
    a.warships[0]!.hp -= 1;
    expect(hashWorld(a)).not.toBe(h);
  });
});

describe("coastal fortification", () => {
  it("makes the Naval Base owner's coast within 30 km a Stone Wall", () => {
    const w = world();
    port(w, 1, BASE_1, 3);
    const level = (tile: number) =>
      coastFortLevel(w.rules, w.map, w.owner, w.buildings, w.tick, tile);
    expect(level(at(8, 2))).toBe(2); // coast, in range
    expect(level(at(1, 5))).toBe(2); // the west coast is in range too
    expect(level(at(4, 5))).toBe(0); // inland
    expect(level(at(51, 5))).toBe(0); // someone else's coast
    // A Naval Port gives none.
    w.buildings[0]!.level = 2;
    expect(level(at(8, 2))).toBe(0);
  });

  it("makes landings and attacks on that coast dearer", () => {
    const w = world();
    const attack = {
      attacker: 2,
      target: 1,
      troops: 50_000,
      lossFactor: 1,
    } as unknown as Attack;
    const before = tileCost(w, attack, at(8, 2));
    port(w, 1, BASE_1, 3);
    const after = tileCost(w, attack, at(8, 2));
    const wall = RULES.walls.levels[1]!;
    expect(after).toBeCloseTo(before * wall.loss + wall.breakTroops, 5);
    // Not without warships in the game.
    const off = world(makeRules({ warships: { enabled: false } }));
    port(off, 1, BASE_1, 2);
    off.buildings[0]!.level = 3;
    expect(tileCost(off, attack, at(8, 2))).toBeCloseTo(before, 5);
  });
});
