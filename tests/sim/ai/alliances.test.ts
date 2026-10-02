/** How bots handle alliances (GAME_DESIGN.md §3.14). */
import { describe, expect, it } from "vitest";
import type { Command, StampedCommand } from "../../../src/sim/commands.ts";
import type { SimEvent } from "../../../src/sim/events.ts";
import { DEFAULT_RULES, makeRules, type Personality } from "../../../src/sim/rules.ts";
import { isAllied } from "../../../src/sim/systems/diplomacy.ts";
import { runTick } from "../../../src/sim/tick.ts";
import type { World } from "../../../src/sim/world.ts";
import { worldFromAscii } from "../../helpers/asciiMap.ts";

const EVERY_TICK = { thinkMinTicks: 1, thinkMaxTicks: 1 };
const RULES = makeRules({
  ai: {
    ...DEFAULT_RULES.ai,
    // On these tiny maps everyone holds a big share of the land: no "runaway leader" rule.
    allyLeaderShare: 1,
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
});

function run(world: World, ticks: number, commands: StampedCommand[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const frame = runTick(world, { tick: world.tick + 1, commands: k === 0 ? commands : [] });
    events.push(...frame.events);
  }
  return events;
}

function send(world: World, playerId: number, command: Command, ticks = 5): SimEvent[] {
  return run(world, ticks, [{ playerId, command }]);
}

/**
 * Player 1 (human) next to player 2 (a bot); player 3 (human) far away, so three
 * contenders are in the game (with two left, nations never ally).
 */
function neighbours(
  bot: "bot" | "tribe",
  homeTroops: number[],
  personality: Personality = "expander",
): World {
  return worldFromAscii(
    `
    1111122222~~~~3
    1111122222~~~~3
    1111122222~~~~3
    `,
    { players: ["human", bot, "human"], homeTroops, personality, rules: RULES },
  );
}

describe("tribes", () => {
  it("accept every alliance request", () => {
    const world = neighbours("tribe", [50_000, 1_000, 5_000]);
    const events = send(world, 1, { type: "allianceRequest", target: 2 });
    expect(events).toContainEqual({ type: "allianceFormed", a: 1, b: 2 });
  });

  it("renew every alliance", () => {
    const world = neighbours("tribe", [50_000, 1_000, 5_000]);
    send(world, 1, { type: "allianceRequest", target: 2 });
    const alliance = [...world.alliances.values()][0]!;
    run(world, alliance.expiresTick - RULES.diplomacy.renewWindowTicks - world.tick);
    const events = send(world, 1, { type: "allianceRenew", ally: 2 });
    expect(events).toContainEqual({ type: "allianceRenewed", a: 1, b: 2 });
  });

  it("attack a neighbouring traitor first", () => {
    const world = neighbours("tribe", [5_000, 3_000, 5_000]);
    // Player 1 becomes a traitor by breaking an alliance with player 3.
    send(world, 1, { type: "allianceRequest", target: 3 }, 1);
    send(world, 3, { type: "allianceRequest", target: 1 }, 1);
    const events = send(world, 1, { type: "allianceBreak", ally: 3 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "attackStarted", attacker: 2, target: 1 }),
    );
  });
});

describe("nations", () => {
  it("accept a much stronger neighbour (appeasement)", () => {
    const world = neighbours("bot", [50_000, 10_000, 5_000]);
    const events = send(world, 1, { type: "allianceRequest", target: 2 });
    expect(events).toContainEqual({ type: "allianceFormed", a: 1, b: 2 });
  });

  it("decline a much weaker neighbour", () => {
    const world = neighbours("bot", [2_000, 10_000, 5_000]);
    const events = send(world, 1, { type: "allianceRequest", target: 2 });
    expect(events).toContainEqual({
      type: "allianceRequestEnded",
      from: 1,
      to: 2,
      reason: "declined",
    });
  });

  it("refuse traitors", () => {
    const world = neighbours("bot", [50_000, 10_000, 5_000]);
    world.players[0]!.traitorUntilTick = world.tick + RULES.diplomacy.traitorTicks;
    const events = send(world, 1, { type: "allianceRequest", target: 2 });
    expect(events.some((e) => e.type === "allianceRequested" && e.from === 2)).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "allianceRequestEnded", reason: "declined" }),
    );
  });

  it("never ally when only two contenders are left", () => {
    const world = worldFromAscii("1111122222", {
      players: ["human", "bot"],
      homeTroops: [50_000, 10_000],
      rules: RULES,
    });
    const events = send(world, 1, { type: "allianceRequest", target: 2 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "allianceRequestEnded", reason: "declined" }),
    );
  });

  it("ask a much stronger neighbour for an alliance", () => {
    const world = neighbours("bot", [50_000, 10_000, 5_000]);
    const events = run(world, 3);
    expect(events).toContainEqual({ type: "allianceRequested", from: 2, to: 1 });
  });

  it("betray an ally they can wipe out (Hard aggressor)", () => {
    const world = neighbours("bot", [1_000, 40_000, 5_000], "aggressor");
    // An alliance the bot accepted earlier, when the human was stronger.
    world.players[0]!.homeTroops = 200_000;
    send(world, 1, { type: "allianceRequest", target: 2 }, 3);
    expect(isAllied(world, 1, 2)).toBe(true);
    world.players[0]!.homeTroops = 1_000;
    const events = run(world, 5);
    expect(events).toContainEqual({ type: "allianceBroken", breaker: 2, victim: 1 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "attackStarted", attacker: 2, target: 1 }),
    );
    expect(world.players[1]!.betrayals).toBe(1);
  });

  it("never betray when they're turtles", () => {
    const world = neighbours("bot", [1_000, 40_000, 5_000], "turtle");
    world.players[0]!.homeTroops = 200_000;
    send(world, 1, { type: "allianceRequest", target: 2 }, 3);
    expect(isAllied(world, 1, 2)).toBe(true);
    world.players[0]!.homeTroops = 1_000;
    const events = run(world, 20);
    expect(events.some((e) => e.type === "allianceBroken")).toBe(false);
    expect(isAllied(world, 1, 2)).toBe(true);
  });

  it("go after traitors first (user request, 2.2)", () => {
    const world = worldFromAscii("111112222233333", {
      players: ["human", "bot", "human"],
      homeTroops: [3_000, 40_000, 3_000],
      personality: "aggressor",
      rules: RULES,
    });
    world.players[2]!.traitorUntilTick = world.tick + RULES.diplomacy.traitorTicks;
    const events = run(world, 3);
    const first = events.find((e) => e.type === "attackStarted" && e.attacker === 2);
    expect(first).toMatchObject({ target: 3 });
  });
});
