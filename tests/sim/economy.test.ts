/** Gold, donations and loot (GAME_DESIGN.md §3.16). Mobilize was removed (D-033). */
import { describe, expect, it } from "vitest";
import type { Command, StampedCommand } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { goldIncome } from "../../src/sim/systems/economy.ts";
import { runTick } from "../../src/sim/tick.ts";
import type { World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
});
const E = RULES.economy;

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

function twoPlayers(
  options: { rules?: GameRules; teams?: number[]; homeTroops?: number[] } = {},
): World {
  return worldFromAscii(
    `
    1111122222
    1111122222
    1111122222
    `,
    {
      rules: options.rules ?? RULES,
      homeTroops: options.homeTroops ?? [5_000, 5_000],
      teams: options.teams,
    },
  );
}

describe("gold income", () => {
  it("is 10 + 0.8·√tiles per tick, rounded down", () => {
    expect(goldIncome(RULES, 49)).toBe(15); // 10 + 5.6
    expect(goldIncome(RULES, 50_000)).toBe(188);
    expect(goldIncome(RULES, 200_000)).toBe(367);
    expect(goldIncome(RULES, 0)).toBe(0);
  });

  it("is earned every tick of play; tribes earn half", () => {
    const world = worldFromAscii(
      `
      1111122222
      1111122222
      1111122222
      `,
      { rules: RULES, players: ["human", "tribe"], homeTroops: [5_000, 5_000] },
    );
    run(world, 10);
    const full = Math.floor(E.incomeBase + E.incomePerSqrtTile * Math.sqrt(15));
    const half = Math.floor(0.5 * (E.incomeBase + E.incomePerSqrtTile * Math.sqrt(15)));
    expect(world.players[0]!.gold).toBe(10 * full);
    expect(world.players[1]!.gold).toBe(10 * half);
    expect(world.players[0]!.lastIncome).toBe(full);
  });

  it("isn't earned in the spawn phase", () => {
    const world = worldFromAscii(`....\n....`, { rules: RULES, phase: "spawn" });
    run(world, 5);
    expect(world.players[0]!.gold).toBe(0);
  });

  it("doesn't exist when the economy is off", () => {
    const world = twoPlayers({ rules: makeRules({ economy: { enabled: false } }) });
    run(world, 20);
    expect(world.players[0]!.gold).toBe(0);
  });
});

describe("mobilize (removed, D-033)", () => {
  it("is no command any more: gold no longer buys troops", () => {
    const world = twoPlayers();
    const me = world.players[0]!;
    me.gold = 100_000;
    const command = { type: "mobilize", percentBp: 1000 } as unknown as Command;
    expect(rejection(send(world, 1, command))).toBe("unknown command mobilize");
    expect(me.homeTroops).toBe(5_000 + me.lastGrowth);
  });
});

describe("donations", () => {
  function allied(): World {
    const world = twoPlayers();
    send(world, 1, { type: "allianceRequest", target: 2 });
    send(world, 2, { type: "allianceReply", from: 1, accept: true });
    return world;
  }

  it("give an ally a share of your home troops", () => {
    const world = allied();
    const events = send(world, 1, { type: "donate", to: 2, resource: "troops", percentBp: 2500 });
    expect(events).toContainEqual({
      type: "donated",
      from: 1,
      to: 2,
      resource: "troops",
      amount: 1_250,
    });
    expect(world.players[0]!.homeTroops).toBe(3_750);
    expect(world.players[1]!.homeTroops).toBe(6_250);
  });

  it("send only the troops that fit under the friend's capacity", () => {
    const world = allied();
    const friend = world.players[1]!;
    friend.homeTroops = friend.capacity - 100;
    send(world, 1, { type: "donate", to: 2, resource: "troops", percentBp: 5000 });
    expect(friend.homeTroops).toBe(friend.capacity);
    expect(world.players[0]!.homeTroops).toBe(4_900);
    expect(
      rejection(send(world, 2, { type: "donate", to: 1, resource: "gold", percentBp: 1 })),
    ).toBe("no gold to give");
  });

  it("give gold, each kind to the same friend once every 10 s", () => {
    const world = allied();
    world.players[0]!.gold = 10_000;
    world.players[1]!.gold = 0;
    send(world, 1, { type: "donate", to: 2, resource: "gold", percentBp: 5000 });
    expect(world.players[1]!.gold).toBe(5_000 + world.players[1]!.lastIncome);
    expect(
      rejection(send(world, 1, { type: "donate", to: 2, resource: "gold", percentBp: 5000 })),
    ).toBe("gave them that too recently");
    // Troops have their own cooldown.
    expect(
      rejection(send(world, 1, { type: "donate", to: 2, resource: "troops", percentBp: 1000 })),
    ).toBeNull();
    run(world, E.donationCooldownTicks);
    expect(
      rejection(send(world, 1, { type: "donate", to: 2, resource: "gold", percentBp: 5000 })),
    ).toBeNull();
  });

  it("work between teammates, but not with strangers", () => {
    const stranger = twoPlayers();
    expect(
      rejection(send(stranger, 1, { type: "donate", to: 2, resource: "troops", percentBp: 1000 })),
    ).toBe("only allies and teammates");
    const team = twoPlayers({ teams: [1, 1] });
    expect(
      rejection(send(team, 1, { type: "donate", to: 2, resource: "troops", percentBp: 1000 })),
    ).toBeNull();
  });
});

describe("loot", () => {
  it("whoever eliminates a player takes half their gold", () => {
    const world = worldFromAscii(
      `
      111111112
      111111111
      `,
      { rules: RULES, homeTroops: [50_000, 0] },
    );
    world.players[1]!.gold = 10_000;
    const before = world.players[0]!.gold;
    const events = run(world, 40, [
      { playerId: 1, command: { type: "attack", target: 2, focusTile: 8, percentBp: 5000 } },
    ]);
    const out = events.find((e) => e.type === "eliminated");
    expect(out).toMatchObject({ type: "eliminated", playerId: 2, by: 1 });
    const loot = out?.type === "eliminated" ? out.loot : 0;
    expect(loot).toBeGreaterThanOrEqual(5_000);
    expect(world.players[1]!.gold).toBe(0);
    expect(world.players[0]!.gold).toBeGreaterThanOrEqual(before + loot);
  });
});

describe("nations and gold", () => {
  it("send troops to a teammate who is losing a war", () => {
    const world = worldFromAscii(
      `
      1111222233
      1111222233
      1111222233
      `,
      {
        rules: RULES,
        players: ["bot", "human", "human"],
        teams: [1, 1, 2],
        personality: "turtle",
        homeTroops: [0, 8_000, 30_000],
      },
    );
    const bot = world.players[0]!;
    bot.homeTroops = bot.capacity;
    run(world, 1, [
      { playerId: 3, command: { type: "attack", target: 2, focusTile: 7, percentBp: 3000 } },
    ]);
    const events = run(world, 80);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "donated", from: 1, to: 2, resource: "troops" }),
    );
  });
});
