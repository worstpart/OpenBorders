/** WorkerHost's frame protocol (milestone 2.8): slim in the worker, restore on the main thread. */
import { describe, expect, it } from "vitest";
import { FrameRestorer, FrameSlimmer } from "../../src/host/workerProtocol.ts";
import type { Command } from "../../src/sim/commands.ts";
import type { TickFrame } from "../../src/sim/frame.ts";
import { makeRules } from "../../src/sim/rules.ts";
import { runTick } from "../../src/sim/tick.ts";
import type { World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

const MAP = `
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~1111111~~~~~~~~~~~~~~2222222~
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
const at = (x: number, y: number) => y * 30 + x;

function tick(w: World, commands: { playerId: number; command: Command }[] = []): TickFrame {
  return runTick(w, { tick: w.tick + 1, commands });
}

describe("the worker frame protocol", () => {
  it("sends each route once and walls only when they change, and restores the same frames", () => {
    const w = worldFromAscii(MAP, { rules: RULES, homeTroops: [20_000, 20_000] });
    for (const p of w.players) p.gold = 10_000_000;
    const slimmer = new FrameSlimmer();
    const restorer = new FrameRestorer();
    const cross = (frame: TickFrame) => {
      const { wire } = slimmer.slim(frame);
      // What postMessage does to it (without moving the buffers, so we can still compare).
      return { wire, restored: restorer.restore(structuredClone(wire)) };
    };

    tick(w, [
      { playerId: 1, command: { type: "build", buildingType: "port", tile: at(7, 2) } },
      { playerId: 2, command: { type: "build", buildingType: "port", tile: at(22, 2) } },
      { playerId: 1, command: { type: "buildWall", points: [at(3, 1), at(3, 5)] } },
    ]);
    const first = tick(w, [
      { playerId: 1, command: { type: "boat", target: 2, tile: at(23, 4), percentBp: 5_000 } },
    ]);
    const a = cross(first);
    expect(a.wire.boats[0]!.route).not.toBeNull();
    expect(a.restored).toEqual(first);

    const second = tick(w);
    const b = cross(second);
    expect(b.wire.boats[0]!.route).toBeNull(); // the main thread has it
    expect(b.wire.walls).toBeNull(); // unchanged
    expect(b.restored).toEqual(second);
    expect(b.restored.boats[0]).toBe(a.restored.boats[0]); // same snapshot, like LocalHost's

    // Ports finish, trade ships sail: still the same frames after the trip.
    let sawTrade = false;
    for (let k = 0; k < 260; k++) {
      const frame = tick(w);
      const { restored } = cross(frame);
      expect(restored).toEqual(frame);
      sawTrade ||= frame.tradeShips.length > 0;
    }
    expect(sawTrade).toBe(true);
  });
});
