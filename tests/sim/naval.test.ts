/** Boats, beachheads and Ports (GAME_DESIGN.md §3.18, milestone 2.7). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { launchBeachhead, retreatAttack } from "../../src/sim/systems/attacks.ts";
import { boatProgress, planBoat, seaRoute } from "../../src/sim/systems/naval.ts";
import { runTick } from "../../src/sim/tick.ts";
import { setOwner, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

// 30 × 9: two islands, 14 tiles of sea between them; a lake inside player 2's island.
const MAP = `
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~222~~22~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
const WIDTH = 30;
const at = (x: number, y: number) => y * WIDTH + x;

function world(rules: GameRules = RULES, homeTroops = [20_000, 5_000], map = MAP): World {
  const w = worldFromAscii(map, { rules, homeTroops });
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

function order(w: World, playerId: number, command: Command): SimEvent[] {
  return step(w, [{ playerId, command }]);
}

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

const boatTo = (target: number, tile: number, percentBp = 5_000): Command => ({
  type: "boat",
  target,
  tile,
  percentBp,
});

describe("planning a crossing", () => {
  it("lands on the target's coast nearest the click, from our nearest coast", () => {
    const w = world();
    const plan = planBoat(RULES, w.map, w.owner, [], 1, w.players[0]!.border, 2, at(23, 4));
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.landingTile).toBe(at(22, 4));
    expect(plan.launchTile).toBe(at(7, 4));
    // 14 sea tiles straight across; 15 steps from coast to coast at 1 tile per tick.
    expect(plan.route.length).toBe(14);
    expect(plan.ticks).toBe(15);
    expect(plan.tilesPerTick).toBe(1);
    expect(plan.lossFactor).toBe(1);
  });

  it("never cuts a corner of land and finds no route between separate seas", () => {
    const w = world();
    // The lake inside player 2's island is a sea of its own.
    expect(planBoat(RULES, w.map, w.owner, [], 2, w.players[1]!.border, 1, at(3, 4))).not.toBe(
      "noRoute",
    );
    expect(seaRoute(w.map, at(24, 4), at(27, 4), 1_000)).not.toBeNull(); // within the lake
    expect(seaRoute(w.map, at(7, 4), at(24, 4), 1_000)).toBeNull(); // ocean → lake
    const route = seaRoute(w.map, at(7, 1), at(22, 7), 10_000)!;
    for (let k = 1; k < route.length; k++) {
      const a = route[k - 1]!;
      const b = route[k]!;
      const dx = (b % WIDTH) - (a % WIDTH);
      const dy = Math.floor(b / WIDTH) - Math.floor(a / WIDTH);
      expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
      if (dx !== 0 && dy !== 0) {
        expect(w.map.terrain[a + dx]).toBe(0);
        expect(w.map.terrain[a + dy * WIDTH]).toBe(0);
      }
    }
  });
});

describe("a boat", () => {
  it("carries troops that count toward the cap, then lands as a beachhead attack", () => {
    const w = world();
    const p1 = w.players[0]!;
    const launched = order(w, 1, boatTo(2, at(23, 4)));
    expect(rejection(launched)).toBeNull();
    expect(p1.homeTroops).toBe(10_000);
    expect(p1.fieldTroops).toBe(10_000);
    const boat = w.boats[0]!;
    expect(launched).toContainEqual(
      expect.objectContaining({ type: "boatLaunched", troops: 10_000, landingTile: at(22, 4) }),
    );
    expect(boat.arriveTick).toBe(w.tick + 15);
    expect(boatProgress(boat, w.tick + 5)).toBe(5);

    const events = run(w, 15);
    const landed = events.find((e) => e.type === "boatLanded");
    expect(landed).toMatchObject({ target: 2, tile: at(22, 4) });
    expect(w.boats).toHaveLength(0);
    // The landing tile is ours: the beachhead took it and spreads from there.
    expect(w.owner[at(22, 4)]).toBe(1);
    const beachhead = w.attacks.find((a) => a.landingTile === at(22, 4))!;
    expect(beachhead).toBeDefined();
    expect(beachhead.attacker).toBe(1);
    expect(beachhead.target).toBe(2);
    run(w, 20);
    expect(w.players[1]!.tiles).toBeLessThan(44);
  });

  it("does not merge with a land attack on the same enemy", () => {
    const w = world();
    order(w, 1, boatTo(2, at(23, 4)));
    run(w, 15);
    const beachhead = w.attacks.find((a) => a.landingTile >= 0)!;
    const before = beachhead.troops;
    // Now we border them (the landing pocket): a land click starts a second army.
    order(w, 1, { type: "attack", target: 2, focusTile: at(26, 2), percentBp: 5_000 });
    const armies = w.attacks.filter((a) => a.attacker === 1 && a.target === 2);
    expect(armies).toHaveLength(2);
    expect(armies.find((a) => a.landingTile < 0)).toBeDefined();
    expect(beachhead.troops).toBeLessThanOrEqual(before);
  });

  it("can be recalled: it sails back and the troops come home", () => {
    const w = world();
    const p1 = w.players[0]!;
    order(w, 1, boatTo(2, at(23, 4)));
    run(w, 5);
    const boat = w.boats[0]!;
    const events = order(w, 1, { type: "recallBoat", boatId: boat.id });
    expect(events).toContainEqual(expect.objectContaining({ type: "boatRecalled" }));
    expect(boatProgress(boat, w.tick)).toBe(6);
    expect(boat.arriveTick).toBe(w.tick + 6);
    expect(rejection(order(w, 1, { type: "recallBoat", boatId: boat.id }))).toBe(
      "already sailing home",
    );
    const back = run(w, 5);
    expect(back).toContainEqual(expect.objectContaining({ type: "boatReturned", troops: 10_000 }));
    expect(p1.homeTroops).toBe(20_000);
    expect(p1.fieldTroops).toBe(0);
    expect(w.owner[at(22, 4)]).toBe(2);
  });

  it("brings its troops home if the landing tile became ours or a friend's", () => {
    const w = world();
    order(w, 1, boatTo(2, at(23, 4)));
    setOwner(w, at(22, 4), 1);
    const events = run(w, 15);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "boatLanded", target: 1, attackId: -1 }),
    );
    expect(w.players[0]!.homeTroops).toBe(20_000);
    expect(w.attacks).toHaveLength(0);
  });

  it("settles neutral land", () => {
    const w = world();
    // Most of player 2's island is empty now (they keep its south, so the game goes on).
    for (let t = 0; t < at(0, 6); t++) if (w.owner[t] === 2) setOwner(w, t, 0);
    expect(rejection(order(w, 1, boatTo(0, at(25, 2), 2_000)))).toBeNull();
    run(w, 60);
    expect(w.owner[at(25, 1)]).toBe(1); // the neutral coast nearest the click
    expect(w.players[0]!.tiles).toBeGreaterThan(49 + 20);
  });

  it("refuses friends, a fourth boat, and land that isn't the target's", () => {
    const w = world(makeRules({ ...RULES, naval: { maxBoats: 3 } }));
    expect(rejection(order(w, 1, boatTo(2, at(3, 3))))).toBe("that land changed hands");
    for (let k = 0; k < 3; k++)
      expect(rejection(order(w, 1, boatTo(2, at(23, 2), 1_000)))).toBeNull();
    expect(rejection(order(w, 1, boatTo(2, at(23, 2), 1_000)))).toBe("all your boats are at sea");
    const allied = world(RULES);
    allied.alliances.set(1 * 0x10000 + 2, {
      a: 1,
      b: 2,
      formedTick: 0,
      expiresTick: 10_000,
      renewA: false,
      renewB: false,
    });
    expect(rejection(order(allied, 1, boatTo(2, at(23, 2))))).toBe("you're allied with them");
  });

  it("sinks with its owner", () => {
    const w = world();
    order(w, 1, boatTo(2, at(23, 4)));
    for (let t = 0; t < w.owner.length; t++) if (w.owner[t] === 1) setOwner(w, t, 2);
    const events = run(w, 1);
    expect(events).toContainEqual(expect.objectContaining({ type: "boatReturned", troops: 0 }));
    expect(w.boats).toHaveLength(0);
  });

  it("is deterministic", () => {
    const play = () => {
      const w = world();
      order(w, 1, boatTo(2, at(23, 4)));
      run(w, 8);
      order(w, 2, boatTo(1, at(3, 2), 3_000));
      run(w, 40);
      return hashWorld(w);
    };
    expect(play()).toBe(play());
  });
});

describe("Ports", () => {
  function withPort(level: number): World {
    const w = world();
    expect(
      rejection(order(w, 1, { type: "build", buildingType: "port", tile: at(7, 3) })),
    ).toBeNull();
    run(w, RULES.buildings.types.port.levels[0]!.buildTicks);
    const port = w.buildings[0]!;
    for (let l = 2; l <= level; l++) {
      order(w, 1, { type: "upgrade", buildingId: port.id });
      run(w, RULES.buildings.types.port.levels[l - 1]!.buildTicks);
    }
    expect(port.level).toBe(level);
    return w;
  }

  it("must stand on the coast", () => {
    const w = world();
    expect(rejection(order(w, 1, { type: "build", buildingType: "port", tile: at(3, 4) }))).toBe(
      "a port must stand on the coast",
    );
  });

  it("makes boats from its coast faster, adds boats, and trains Marines at level II", () => {
    const one = withPort(1);
    order(one, 1, boatTo(2, at(23, 4)));
    expect(one.boats[0]!.tilesPerTick).toBe(1.5);
    expect(one.boats[0]!.arriveTick - one.tick).toBe(10); // 15 steps at 1.5
    expect(one.boats[0]!.lossFactor).toBe(1);

    const two = withPort(2);
    order(two, 1, boatTo(2, at(23, 4)));
    expect(two.boats[0]!.tilesPerTick).toBe(2);
    expect(two.boats[0]!.lossFactor).toBe(0.8);
    for (let k = 0; k < 4; k++) order(two, 1, boatTo(2, at(23, 2), 500));
    expect(two.boats).toHaveLength(5); // 3 + 2 from the Naval Port
    expect(rejection(order(two, 1, boatTo(2, at(23, 2), 500)))).toBe("all your boats are at sea");
    expect(two.players[0]!.bonus.income).toBe(15); // harbour income; trade comes on top (§3.19)
  });

  it("goes up to level III, the Naval Base (2B.6), and no further", () => {
    const w = withPort(3);
    expect(w.buildings[0]!.level).toBe(3);
    expect(rejection(order(w, 1, { type: "upgrade", buildingId: w.buildings[0]!.id }))).toBe(
      "already at the top level",
    );
  });
});

describe("a landing pocket", () => {
  // Player 1 lands deep inside player 2's land (as an airborne assault will in 2B).
  const INLAND = `
    ~~~~~~~~~~~~~~~~~~~~
    ~111~~2222222222222~
    ~111~~2222222222222~
    ~111~~2222222222222~
    ~111~~2222222222222~
    ~111~~2222222222222~
    ~~~~~~~~~~~~~~~~~~~~
  `;
  const W = 20;

  it("can't be encircled while its attack advances; once it stops, it can", () => {
    const w = worldFromAscii(INLAND, { rules: RULES, homeTroops: [50_000, 60_000] });
    const landing = 3 * W + 12;
    const attack = launchBeachhead(w, w.players[0]!, 2, landing, landing, 4_000, 1);
    run(w, 3);
    expect(w.owner[landing]).toBe(1);
    // Enclosed by player 2 on every side, yet it holds while the army advances.
    run(w, 2 * RULES.encirclement.intervalTicks);
    expect(w.owner[landing]).toBe(1);
    expect(attack.ended).toBe(false);
    retreatAttack(w, attack, false);
    run(w, 2 * RULES.encirclement.intervalTicks + RULES.attack.retreatTicks);
    expect(w.owner[landing]).toBe(2);
  });
});
