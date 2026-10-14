/** Teams (GAME_DESIGN.md §3.15). */
import { describe, expect, it } from "vitest";
import type { Command, StampedCommand } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { tileAt } from "../../src/sim/map/gameMap.ts";
import { DEFAULT_RULES, makeRules } from "../../src/sim/rules.ts";
import { areFriendly, isAllied } from "../../src/sim/systems/diplomacy.ts";
import { runTick } from "../../src/sim/tick.ts";
import { createWorld, sameTeam, type World } from "../../src/sim/world.ts";
import { ascii, ownersToAscii, worldFromAscii } from "../helpers/asciiMap.ts";

const EVERY_TICK = { thinkMinTicks: 1, thinkMaxTicks: 1 };
const RULES = makeRules({
  ai: {
    ...DEFAULT_RULES.ai,
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
  victory: { ...DEFAULT_RULES.victory, landShare: 2, teamLandShare: 2 },
});
/** Default win shares (70%, teams 85%), for the victory tests. */
const WIN_RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
});

function run(world: World, ticks: number, commands: StampedCommand[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks && world.phase !== "ended"; k++) {
    const frame = runTick(world, { tick: world.tick + 1, commands: k === 0 ? commands : [] });
    events.push(...frame.events);
  }
  return events;
}

function send(world: World, playerId: number, command: Command, ticks = 1): SimEvent[] {
  return run(world, ticks, [{ playerId, command }]);
}

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

/** Players 1 and 2 (team 1) side by side; player 3 (team 2) across the water. */
function teammates(): World {
  return worldFromAscii(
    `
    11111222~~3
    11111222~~3
    11111222~~3
    `,
    { rules: RULES, teams: [1, 1, 2], homeTroops: [5_000, 5_000, 5_000] },
  );
}

describe("teams", () => {
  it("free-for-all worlds have no teams", () => {
    const world = worldFromAscii("1122", { rules: RULES });
    expect(world.teamCount).toBe(0);
    expect(sameTeam(world, 1, 2)).toBe(false);
  });

  it("teammates are friendly; other teams are not", () => {
    const world = teammates();
    expect(world.teamCount).toBe(2);
    expect(sameTeam(world, 1, 2)).toBe(true);
    expect(areFriendly(world, 1, 2)).toBe(true);
    expect(areFriendly(world, 1, 3)).toBe(false);
    expect(isAllied(world, 1, 2)).toBe(false); // a team isn't an alliance
  });

  it("rejects invalid team numbers", () => {
    const map = worldFromAscii("1").map;
    expect(() =>
      createWorld({ seed: 1, map, players: [{ name: "A", kind: "human", team: -1 }] }),
    ).toThrow(RangeError);
  });

  it("teammates can't attack each other", () => {
    const world = teammates();
    const events = send(world, 1, {
      type: "attack",
      target: 2,
      focusTile: tileAt(world.map, 5, 1),
      percentBp: 5_000,
    });
    expect(rejection(events)).toBe("they're your teammate");
    expect(world.attacks).toHaveLength(0);
  });

  it("asking a teammate for an alliance is rejected; other teams can be asked", () => {
    const world = teammates();
    expect(rejection(send(world, 1, { type: "allianceRequest", target: 2 }))).toBe(
      "you're on the same team",
    );
    const events = send(world, 1, { type: "allianceRequest", target: 3 });
    expect(events).toContainEqual({ type: "allianceRequested", from: 1, to: 3 });
  });

  it("teammates never encircle each other", () => {
    // Player 2's pocket inside player 1's land is enclosed by a teammate only: safe.
    const world = worldFromAscii(
      `
      11111222~3
      12111222~3
      11111222~3
      `,
      { rules: RULES, teams: [1, 1, 2] },
    );
    world.players[1]!.encircleDirty = true;
    run(world, RULES.encirclement.intervalTicks * 2);
    expect(ownersToAscii(world)).toBe(
      ascii(`
      11111222~3
      12111222~3
      11111222~3
      `),
    );
  });
});

describe("team victory", () => {
  it("a team wins on its combined land (85%); the biggest member is the winner", () => {
    // 20 land tiles: team 1 holds 8 + 10 = 18 (90%), neither member alone (70% = 14).
    const world = worldFromAscii(
      `
      ~~~~~~~~~~~~
      ~1111222223~
      ~1111222223~
      ~~~~~~~~~~~~
      `,
      { rules: WIN_RULES, teams: [1, 1, 2] },
    );
    const events = run(world, 2);
    expect(events).toContainEqual({ type: "gameOver", winner: 2, team: 1, reason: "landShare" });
    expect(world.winningTeam).toBe(1);
  });

  it("a team needs more than a lone player: 70% together isn't enough (2B.6)", () => {
    // Team 1 holds 8 + 6 = 14 of 20 land tiles (70%).
    const world = worldFromAscii(
      `
      ~~~~~~~~~~~~
      ~1111222333~
      ~1111222333~
      ~~~~~~~~~~~~
      `,
      { rules: WIN_RULES, teams: [1, 1, 2] },
    );
    run(world, 2);
    expect(world.phase).toBe("playing");
  });

  it("allied teams don't win together", () => {
    // Team 1 holds 8 of 20 and team 2 holds 6; allied, they'd hold 70%.
    const world = worldFromAscii(
      `
      ~~~~~~~~~~~~
      ~1111222333~
      ~1111222333~
      ~~~~~~~~~~~~
      `,
      { rules: WIN_RULES, teams: [1, 2, 3] },
    );
    send(world, 1, { type: "allianceRequest", target: 2 });
    send(world, 2, { type: "allianceRequest", target: 1 });
    expect(isAllied(world, 1, 2)).toBe(true);
    const events = run(world, 20);
    expect(events.some((e) => e.type === "gameOver")).toBe(false);
  });

  it("the last team standing wins, even with tribes left", () => {
    // Player 2 (team 2) has no land; the tribe (player 3) can't win and doesn't block.
    const world = worldFromAscii("1111.333", {
      rules: WIN_RULES,
      players: ["human", "human", "tribe"],
      teams: [1, 2, 0],
    });
    const events = run(world, 2);
    expect(events).toContainEqual({ type: "gameOver", winner: 1, team: 1, reason: "lastStanding" });
  });

  it("free-for-all: a tribe still blocks the last-standing win", () => {
    const world = worldFromAscii("1111.333", {
      rules: WIN_RULES,
      players: ["human", "human", "tribe"],
    });
    const events = run(world, 2);
    expect(events.some((e) => e.type === "gameOver")).toBe(false);
  });
});

describe("team-aware nations", () => {
  it("never attack a teammate, even a weak one", () => {
    const world = worldFromAscii(
      `
      111112222~~3
      111112222~~3
      `,
      {
        rules: RULES,
        players: ["bot", "bot", "human"],
        teams: [1, 1, 2],
        homeTroops: [50_000, 500, 5_000],
        personality: "aggressor",
      },
    );
    const events = run(world, 100);
    expect(events.some((e) => e.type === "attackStarted" && e.target !== 0)).toBe(false);
    expect(events.some((e) => e.type === "commandRejected")).toBe(false);
    expect(events.some((e) => e.type === "allianceRequested")).toBe(false);
  });

  it("count a whole team as one contender: with two sides left they won't ally", () => {
    // Three players, but only two sides: the nation refuses even a much stronger neighbour.
    const world = worldFromAscii("1111122222~~3", {
      rules: RULES,
      players: ["human", "bot", "human"],
      teams: [1, 2, 1],
      homeTroops: [50_000, 10_000, 5_000],
    });
    const events = send(world, 1, { type: "allianceRequest", target: 2 }, 5);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "allianceRequestEnded", reason: "declined" }),
    );
  });

  // A nation (1) between two equal enemies (2, 3); its teammate (4) owns land next to both
  // and attacks one of them.
  function firstTarget(teammateTarget: 2 | 3): number | undefined {
    const world = worldFromAscii("44422222111113333344", {
      rules: RULES,
      players: ["bot", "human", "human", "human"],
      teams: [1, 2, 2, 1],
      homeTroops: [40_000, 3_000, 3_000, 20_000],
      personality: "aggressor",
    });
    const focusTile = teammateTarget === 2 ? 3 : 17;
    const events = run(world, 3, [
      {
        playerId: 4,
        command: { type: "attack", target: teammateTarget, focusTile, percentBp: 2_000 },
      },
    ]);
    const first = events.find((e) => e.type === "attackStarted" && e.attacker === 1);
    return first?.type === "attackStarted" ? first.target : undefined;
  }

  it("gang up on the enemy a teammate is attacking", () => {
    expect(firstTarget(3)).toBe(3);
    expect(firstTarget(2)).toBe(2);
  });
});
