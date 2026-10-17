/** Trade ships between Ports (GAME_DESIGN.md §3.19, milestone 2.8). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { tradeGoldFor } from "../../src/sim/systems/trade.ts";
import { runTick } from "../../src/sim/tick.ts";
import { setOwner, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

// 30 × 9: players 1 and 3 share the west island, player 2 has the east one with a lake.
const MAP = `
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~222~~22~
  ~3333333~~~~~~~~~~~~~~2222222~
  ~3333333~~~~~~~~~~~~~~2222222~
  ~3333333~~~~~~~~~~~~~~2222222~
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
const WIDTH = 30;
const at = (x: number, y: number) => y * WIDTH + x;
const PORT_TICKS = RULES.buildings.types.port.levels[0]!.buildTicks;

function world(rules: GameRules = RULES): World {
  const w = worldFromAscii(MAP, { rules, homeTroops: [5_000, 5_000, 5_000] });
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

/** Players build Ports at these tiles, all at once, and wait until they are finished. */
function withPorts(w: World, ports: [player: number, tile: number][]): void {
  const commands = ports.map(([playerId, tile]) => ({
    playerId,
    command: { type: "build", buildingType: "port", tile } as Command,
  }));
  const events = step(w, commands);
  expect(events.filter((e) => e.type === "commandRejected")).toEqual([]);
  run(w, PORT_TICKS);
  expect(w.buildings.every((b) => b.level === 1)).toBe(true);
}

const docked = (events: SimEvent[]) =>
  events.filter((e): e is Extract<SimEvent, { type: "tradeDocked" }> => e.type === "tradeDocked");

describe("trade ships", () => {
  it("sail between two players' Ports and pay both owners when they dock", () => {
    const w = world();
    withPorts(w, [
      [1, at(7, 2)],
      [2, at(22, 2)],
    ]);
    const events = run(w, 400);
    const trips = docked(events);
    // Each Port I sends one ship per 20 s: two each in 40 s, all docked (14-tile crossing).
    expect(trips.filter((t) => t.owner === 1)).toHaveLength(2);
    expect(trips.filter((t) => t.owner === 2)).toHaveLength(2);
    const gold = tradeGoldFor(RULES, 14);
    expect(gold).toBe(1_168); // 1,000 + 12 a tile (D-033)
    for (const trip of trips) {
      expect(trip.gold).toBe(gold);
      expect(trip.receiver).toBe(trip.owner === 1 ? 2 : 1);
    }
    expect(w.players[0]!.tradeGold).toBe(4 * gold);
    expect(w.players[1]!.tradeGold).toBe(4 * gold);
  });

  it("need a partner: a lone Port, or one on another sea, sends nothing", () => {
    const lone = world();
    withPorts(lone, [[1, at(7, 2)]]);
    run(lone, 400);
    expect(lone.nextTradeShipId).toBe(1);

    // Player 2's Port stands on the lake inside its island: not the same sea.
    const lake = world();
    withPorts(lake, [
      [1, at(7, 2)],
      [2, at(24, 4)],
    ]);
    run(lake, 400);
    expect(lake.nextTradeShipId).toBe(1);
  });

  it("are faster to come from a Naval Port (one every 10 s)", () => {
    const w = world();
    withPorts(w, [
      [1, at(7, 2)],
      [2, at(22, 2)],
    ]);
    step(w, [{ playerId: 1, command: { type: "upgrade", buildingId: w.buildings[0]!.id } }]);
    run(w, RULES.buildings.types.port.levels[1]!.buildTicks);
    const trips = docked(run(w, 400));
    expect(trips.filter((t) => t.owner === 1)).toHaveLength(4);
    expect(trips.filter((t) => t.owner === 2)).toHaveLength(2);
  });

  it("dock with whoever holds the Port now — no gold if it is the ship's own owner", () => {
    const w = world();
    withPorts(w, [
      [1, at(1, 1)],
      [2, at(22, 2)],
      [3, at(7, 7)],
    ]);
    // Wait for a ship of player 1's bound for player 2's Port, then hand that Port over.
    let ship = w.tradeShips.find((s) => s.owner === 1 && s.toPort === w.buildings[1]!.id);
    for (let k = 0; k < 3_000 && !ship; k++) {
      step(w);
      ship = w.tradeShips.find((s) => s.owner === 1 && s.toPort === w.buildings[1]!.id);
    }
    expect(ship).toBeDefined();
    setOwner(w, at(22, 2), 1);
    let events: SimEvent[] = [];
    while (w.tradeShips.includes(ship!)) events = events.concat(step(w));
    const trip = docked(events).find((t) => t.shipId === ship!.id)!;
    expect(w.buildings[1]!.owner).toBe(1);
    expect(trip.gold).toBe(0);
    expect(trip.receiver).toBe(0);
  });

  it("are lost with their owner and when the destination Port is destroyed", () => {
    const w = world();
    withPorts(w, [
      [1, at(7, 2)],
      [2, at(22, 2)],
    ]);
    while (!w.tradeShips.some((s) => s.owner === 2)) step(w);
    const before = w.players[0]!.tradeGold;
    // Player 2's Port is wiped out (as a strike will in 2B): ships bound there are lost.
    w.buildings = w.buildings.filter((b) => b.owner !== 1);
    w.buildingAt[at(7, 2)] = -1;
    const trips = docked(run(w, 40));
    expect(trips.length).toBeGreaterThan(0);
    expect(trips.every((t) => t.gold === 0)).toBe(true);
    expect(w.players[0]!.tradeGold).toBe(before);
  });

  it("can be turned off, and the game stays deterministic with them", () => {
    const off = world(makeRules({ ...RULES, trade: { enabled: false } }));
    withPorts(off, [
      [1, at(7, 2)],
      [2, at(22, 2)],
    ]);
    run(off, 400);
    expect(off.nextTradeShipId).toBe(1);

    const play = () => {
      const w = world();
      withPorts(w, [
        [1, at(1, 1)],
        [2, at(22, 2)],
        [3, at(7, 7)],
      ]);
      run(w, 500);
      return hashWorld(w);
    };
    expect(play()).toBe(play());
  });
});
