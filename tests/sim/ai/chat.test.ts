/** How nations use emojis and pings (GAME_DESIGN.md §3.20). */
import { describe, expect, it } from "vitest";
import { pingIntel } from "../../../src/sim/ai/chat.ts";
import type { Command, StampedCommand } from "../../../src/sim/commands.ts";
import type { SimEvent } from "../../../src/sim/events.ts";
import { DEFAULT_RULES, makeRules } from "../../../src/sim/rules.ts";
import { runTick } from "../../../src/sim/tick.ts";
import type { World } from "../../../src/sim/world.ts";
import { worldFromAscii } from "../../helpers/asciiMap.ts";

const EVERY_TICK = { thinkMinTicks: 1, thinkMaxTicks: 1 };
const RULES = makeRules({
  ai: {
    ...DEFAULT_RULES.ai,
    difficulties: {
      easy: { ...DEFAULT_RULES.ai.difficulties.easy, ...EVERY_TICK },
      medium: { ...DEFAULT_RULES.ai.difficulties.medium, ...EVERY_TICK },
      hard: { ...DEFAULT_RULES.ai.difficulties.hard, ...EVERY_TICK },
    },
  },
  tribe: EVERY_TICK,
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  diplomacy: { enabled: false },
  chat: { nationEmoteChance: 1 },
});
const emoji = (e: string) => RULES.chat.emojis.indexOf(e);

function run(world: World, ticks: number, commands: StampedCommand[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const frame = runTick(world, { tick: world.tick + 1, commands: k === 0 ? commands : [] });
    events.push(...frame.events);
  }
  return events;
}

function send(world: World, playerId: number, command: Command, ticks = 3): SimEvent[] {
  return run(world, ticks, [{ playerId, command }]);
}

/** A nation (2) between a human (1) and a far-away human (3), at low troops (it waits). */
function quiet(): World {
  return worldFromAscii(
    `
    11111~22222~33333
    11111~22222~33333
    `,
    { players: ["human", "bot", "human"], rules: RULES, homeTroops: [5_000, 10, 5_000] },
  );
}

describe("nation emojis", () => {
  it("answer a person's emoji", () => {
    const world = quiet();
    const events = send(world, 1, { type: "emote", to: 2, emoji: emoji("👋") });
    expect(events).toContainEqual({ type: "emoted", from: 2, to: 1, emoji: emoji("👋") });
  });

  it("answer rudeness in kind", () => {
    const world = quiet();
    const events = send(world, 1, { type: "emote", to: 2, emoji: emoji("😂") });
    const reply = events.find((e) => e.type === "emoted" && e.from === 2);
    expect(reply).toMatchObject({ to: 1 });
    expect(["😂", "😠"]).toContain(RULES.chat.emojis[(reply as { emoji: number }).emoji]);
  });

  it("don't talk to other bots", () => {
    const world = worldFromAscii("11111~22222", {
      players: ["bot", "bot"],
      rules: RULES,
      homeTroops: [10, 10],
    });
    const events = send(world, 1, { type: "emote", to: 2, emoji: emoji("👋") });
    expect(events.filter((e) => e.type === "emoted" && e.from === 2)).toEqual([]);
  });
});

describe("pings and nations", () => {
  it("only friends' pings count", () => {
    const world = worldFromAscii(
      `
      1111122222
      3333344444
      `,
      {
        players: ["human", "bot", "human", "human"],
        teams: [1, 1, 2, 3],
        rules: RULES,
      },
    );
    send(world, 1, { type: "ping", tile: 12, kind: "attack" }, 1);
    send(world, 3, { type: "ping", tile: 18, kind: "attack" }, 1);
    const nation = world.players[1]!;
    const intel = pingIntel(world, nation);
    expect([...(intel?.attack.keys() ?? [])]).toEqual([3]);
    expect(intel?.attack.get(3)).toBe(12);
  });

  it("a teammate's 'attack here' turns a nation on that player, aimed at the ping", () => {
    // Nation 2 borders 3 and 4 equally; its teammate 1 pings player 4's land.
    const map = `
      1112223333
      1112223333
      1112224444
      1112224444
    `;
    const setup = () =>
      worldFromAscii(map, {
        players: ["human", "bot", "human", "human"],
        teams: [1, 1, 2, 3],
        personality: "aggressor",
        rules: RULES,
        homeTroops: [100, 40_000, 2_000, 2_000],
      });
    const firstTarget = (world: World, commands: StampedCommand[]) => {
      const events = run(world, 6, commands);
      const attack = events.find(
        (e) => e.type === "attackStarted" && e.attacker === 2 && e.target !== 0,
      );
      return attack?.type === "attackStarted" ? attack : null;
    };
    const unpinged = firstTarget(setup(), []);
    expect(unpinged).not.toBeNull();
    const other = unpinged!.target === 3 ? 4 : 3;
    const world = setup();
    const tile = other === 4 ? 39 : 9;
    const pinged = firstTarget(world, [
      { playerId: 1, command: { type: "ping", tile, kind: "attack" } },
    ]);
    expect(pinged?.target).toBe(other);
    expect(world.attacks.find((a) => a.attacker === 2)?.focusTile).toBe(tile);
  });

  it("nations ping their human teammates where they strike", () => {
    const world = worldFromAscii(
      `
      11122233
      11122233
      `,
      {
        players: ["human", "bot", "human"],
        teams: [1, 1, 2],
        personality: "aggressor",
        rules: RULES,
        homeTroops: [100, 40_000, 1_000],
      },
    );
    const events = run(world, 6);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "pinged", from: 2, kind: "attack", target: 3 }),
    );
  });

  it("…but not when they have no human friend", () => {
    const world = worldFromAscii(
      `
      11122233
      11122233
      `,
      {
        players: ["bot", "bot", "human"],
        teams: [1, 1, 2],
        personality: "aggressor",
        rules: RULES,
        homeTroops: [100, 40_000, 1_000],
      },
    );
    expect(run(world, 6).filter((e) => e.type === "pinged")).toEqual([]);
  });
});
