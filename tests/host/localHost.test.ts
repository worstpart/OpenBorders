import { describe, expect, it } from "vitest";
import { LocalHost } from "../../src/host/localHost.ts";
import type { TickFrame } from "../../src/sim/frame.ts";
import { createMap, Terrain } from "../../src/sim/map/gameMap.ts";

const map = createMap(20, 20, new Uint8Array(400).fill(Terrain.Plains));
const setup = {
  seed: 3,
  map,
  players: [
    { name: "You", kind: "human" as const },
    { name: "Bot", kind: "bot" as const },
  ],
};

describe("LocalHost", () => {
  it("returns the initial state and delivers one frame per tick", async () => {
    const host = new LocalHost({ localPlayerId: 1, clock: "manual" });
    const initial = await host.start(setup);
    expect(initial.localPlayerId).toBe(1);
    expect(initial.frame.tick).toBe(0);
    expect(initial.owner.every((owner) => owner === 0)).toBe(true);

    const frames: TickFrame[] = [];
    host.onFrame((frame) => frames.push(frame));
    host.step(3);
    expect(frames.map((f) => f.tick)).toEqual([1, 2, 3]);
    host.dispose();
  });

  it("stamps commands with the local player and delivers them in the next turn", async () => {
    const host = new LocalHost({ localPlayerId: 1, clock: "manual" });
    await host.start(setup);
    host.step(); // bots spawn
    host.send({ type: "spawn", tile: 210 });
    const frame = host.step();
    expect(frame.events).toContainEqual({
      type: "spawned",
      playerId: 1,
      tile: 210,
      automatic: false,
    });
    // Commands are consumed once.
    expect(host.step().events.filter((e) => e.type === "spawned")).toEqual([]);
    host.dispose();
  });

  it("runs ticks on its own in realtime mode, and stops when paused", async () => {
    const host = new LocalHost({ localPlayerId: 1 });
    host.setSpeed(10); // 10 ms per tick keeps the test fast
    await host.start(setup);
    const ticks: number[] = [];
    host.onFrame((frame) => ticks.push(frame.tick));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks).toEqual(ticks.map((_, k) => k + 1)); // in order, none skipped

    host.pause();
    const pausedAt = ticks.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ticks.length).toBe(pausedAt);
    host.dispose();
  });

  it("refuses to start twice", async () => {
    const host = new LocalHost({ localPlayerId: 1, clock: "manual" });
    await host.start(setup);
    await expect(host.start(setup)).rejects.toThrow(/twice/);
    host.dispose();
  });
});
