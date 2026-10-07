/** Emojis and map pings (GAME_DESIGN.md §3.20). */
import { describe, expect, it } from "vitest";
import type { Command, StampedCommand } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { runTick } from "../../src/sim/tick.ts";
import type { World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
});
const C = RULES.chat;

function run(world: World, ticks: number, commands: StampedCommand[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const frame = runTick(world, { tick: world.tick + 1, commands: k === 0 ? commands : [] });
    events.push(...frame.events);
  }
  return events;
}

function send(world: World, playerId: number, command: Command): SimEvent[] {
  return run(world, 1, [{ playerId, command }]);
}

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

function threePlayers(rules = RULES): World {
  return worldFromAscii(
    `
    111112222233333
    111112222233333
    `,
    { rules, homeTroops: [5_000, 5_000, 5_000] },
  );
}

describe("emojis", () => {
  it("go to one player or to everyone, by index", () => {
    const world = threePlayers();
    expect(send(world, 1, { type: "emote", to: 2, emoji: 0 })).toContainEqual({
      type: "emoted",
      from: 1,
      to: 2,
      emoji: 0,
    });
    expect(send(world, 3, { type: "emote", to: 0, emoji: 5 })).toContainEqual({
      type: "emoted",
      from: 3,
      to: 0,
      emoji: 5,
    });
  });

  it("have a cooldown per sender", () => {
    const world = threePlayers();
    send(world, 1, { type: "emote", to: 2, emoji: 0 });
    expect(rejection(send(world, 1, { type: "emote", to: 3, emoji: 1 }))).toBe(
      "too soon after your last emoji",
    );
    run(world, C.emoteCooldownTicks - 2);
    expect(rejection(send(world, 1, { type: "emote", to: 3, emoji: 1 }))).toBeNull();
  });

  it("reject unknown emojis, yourself, gone players, and games with chat off", () => {
    const world = threePlayers();
    expect(rejection(send(world, 1, { type: "emote", to: 2, emoji: C.emojis.length }))).toBe(
      "no such emoji",
    );
    expect(rejection(send(world, 1, { type: "emote", to: 2, emoji: 0.5 }))).toBe("no such emoji");
    expect(rejection(send(world, 1, { type: "emote", to: 1, emoji: 0 }))).toBe("invalid player");
    world.players[2]!.alive = false;
    expect(rejection(send(world, 1, { type: "emote", to: 3, emoji: 0 }))).toBe(
      "that player is gone",
    );
    const off = threePlayers(makeRules({ chat: { enabled: false } }));
    expect(rejection(send(off, 1, { type: "emote", to: 2, emoji: 0 }))).toBe(
      "chat is off in this game",
    );
  });
});

describe("map pings", () => {
  it("record who owned the pinged tile, and are part of the game state", () => {
    const world = threePlayers();
    const before = hashWorld(world);
    const events = send(world, 1, { type: "ping", tile: 7, kind: "attack" });
    expect(events).toContainEqual({
      type: "pinged",
      pingId: 1,
      from: 1,
      tile: 7,
      kind: "attack",
      target: 2,
    });
    expect(world.pings).toHaveLength(1);
    expect(world.pings[0]!.expiresTick).toBe(world.tick + C.pingTicks);
    expect(hashWorld(world)).not.toBe(before);
  });

  it("run out after pingTicks", () => {
    const world = threePlayers();
    send(world, 1, { type: "ping", tile: 3, kind: "defend" });
    run(world, C.pingTicks - 1);
    expect(world.pings).toHaveLength(1);
    run(world, 1);
    expect(world.pings).toHaveLength(0);
  });

  it("have a cooldown, and a player's oldest goes past the limit", () => {
    const world = threePlayers();
    send(world, 1, { type: "ping", tile: 0, kind: "watch" });
    expect(rejection(send(world, 1, { type: "ping", tile: 1, kind: "watch" }))).toBe(
      "too soon after your last ping",
    );
    for (let k = 1; k <= C.maxPingsPerPlayer; k++) {
      run(world, C.pingCooldownTicks);
      send(world, 1, { type: "ping", tile: k, kind: "watch" });
    }
    expect(world.pings.map((p) => p.tile)).toEqual(
      Array.from({ length: C.maxPingsPerPlayer }, (_, k) => k + 1),
    );
  });

  it("reject bad tiles and kinds", () => {
    const world = threePlayers();
    expect(rejection(send(world, 1, { type: "ping", tile: -1, kind: "attack" }))).toBe(
      "invalid tile",
    );
    expect(rejection(send(world, 1, { type: "ping", tile: 10_000, kind: "attack" }))).toBe(
      "invalid tile",
    );
    expect(
      rejection(send(world, 1, { type: "ping", tile: 1, kind: "nuke" as unknown as "attack" })),
    ).toBe("no such ping");
  });

  it("vanish when the pinger is eliminated", () => {
    const world = threePlayers();
    send(world, 3, { type: "ping", tile: 1, kind: "attack" });
    world.players[2]!.alive = false;
    run(world, 1);
    expect(world.pings).toHaveLength(0);
  });
});
