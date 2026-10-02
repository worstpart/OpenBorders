/** Alliances (GAME_DESIGN.md §3.14). */
import { describe, expect, it } from "vitest";
import type { Command, StampedCommand } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules } from "../../src/sim/rules.ts";
import { tileCost } from "../../src/sim/systems/attacks.ts";
import { isAllied, isTraitor } from "../../src/sim/systems/diplomacy.ts";
import { runTick } from "../../src/sim/tick.ts";
import type { World } from "../../src/sim/world.ts";
import { ascii, ownersToAscii, worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
});
const D = RULES.diplomacy;

function run(world: World, ticks: number, commands: StampedCommand[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const frame = runTick(world, { tick: world.tick + 1, commands: k === 0 ? commands : [] });
    events.push(...frame.events);
  }
  return events;
}

/** One command by one player, applied next tick; returns that tick's events. */
function send(world: World, playerId: number, command: Command): SimEvent[] {
  return run(world, 1, [{ playerId, command }]);
}

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

function twoPlayers(homeTroops = [5_000, 5_000]): World {
  return worldFromAscii(
    `
    1111122222
    1111122222
    1111122222
    `,
    { rules: RULES, homeTroops },
  );
}

describe("alliance requests", () => {
  it("form an alliance when accepted, lasting 5 minutes", () => {
    const world = twoPlayers();
    const asked = send(world, 1, { type: "allianceRequest", target: 2 });
    expect(asked).toContainEqual({ type: "allianceRequested", from: 1, to: 2 });
    expect(world.allianceRequests).toHaveLength(1);

    const answered = send(world, 2, { type: "allianceReply", from: 1, accept: true });
    expect(answered).toContainEqual({ type: "allianceFormed", a: 1, b: 2 });
    expect(isAllied(world, 1, 2)).toBe(true);
    expect(world.allianceRequests).toHaveLength(0);
    expect([...world.alliances.values()][0]!.expiresTick).toBe(world.tick + D.durationTicks);
  });

  it("asking someone who already asked you accepts their request", () => {
    const world = twoPlayers();
    send(world, 2, { type: "allianceRequest", target: 1 });
    const events = send(world, 1, { type: "allianceRequest", target: 2 });
    expect(events).toContainEqual({ type: "allianceFormed", a: 1, b: 2 });
  });

  it("can be declined", () => {
    const world = twoPlayers();
    send(world, 1, { type: "allianceRequest", target: 2 });
    const events = send(world, 2, { type: "allianceReply", from: 1, accept: false });
    expect(events).toContainEqual({
      type: "allianceRequestEnded",
      from: 1,
      to: 2,
      reason: "declined",
    });
    expect(isAllied(world, 1, 2)).toBe(false);
  });

  it("expire after 20 s, and the same player can be asked again only after 30 s", () => {
    const world = twoPlayers();
    send(world, 1, { type: "allianceRequest", target: 2 });
    expect(rejection(send(world, 1, { type: "allianceRequest", target: 2 }))).toBe(
      "request already sent",
    );
    const events = run(world, D.requestTicks - 1);
    expect(events).toContainEqual({
      type: "allianceRequestEnded",
      from: 1,
      to: 2,
      reason: "expired",
    });
    expect(rejection(send(world, 1, { type: "allianceRequest", target: 2 }))).toBe(
      "asked them too recently",
    );
    run(world, D.requestCooldownTicks - D.requestTicks);
    expect(rejection(send(world, 1, { type: "allianceRequest", target: 2 }))).toBeNull();
  });

  it("are rejected when alliances are off, or before the match starts", () => {
    const off = worldFromAscii("1122", {
      rules: makeRules({ diplomacy: { enabled: false } }),
    });
    expect(rejection(send(off, 1, { type: "allianceRequest", target: 2 }))).toBe(
      "alliances are off in this game",
    );
    const spawn = worldFromAscii("....", { players: ["human", "human"], phase: "spawn" });
    expect(rejection(send(spawn, 1, { type: "allianceRequest", target: 2 }))).toBe(
      "the match hasn't started",
    );
  });
});

describe("allies", () => {
  function allied(homeTroops?: number[]): World {
    const world = twoPlayers(homeTroops);
    send(world, 1, { type: "allianceRequest", target: 2 });
    send(world, 2, { type: "allianceRequest", target: 1 });
    return world;
  }

  it("can't attack each other", () => {
    const world = allied();
    const events = send(world, 1, { type: "attack", target: 2, focusTile: 5, percentBp: 5000 });
    expect(rejection(events)).toBe("you're allied with them");
  });

  it("call off running attacks between them, without the retreat loss", () => {
    const world = twoPlayers([12_000, 5_000]);
    send(world, 1, { type: "attack", target: 2, focusTile: 7, percentBp: 5000 });
    send(world, 2, { type: "allianceRequest", target: 1 });
    send(world, 1, { type: "allianceReply", from: 2, accept: true });
    const attack = world.attacks[0]!;
    expect(attack.retreatTick).toBeGreaterThan(0);
    const army = attack.troops;
    const before = world.players[0]!.homeTroops;
    const events = run(world, RULES.attack.retreatTicks + 1);
    const ended = events.find((e) => e.type === "attackEnded");
    expect(ended).toMatchObject({ reason: "retreated", attacker: 1 });
    expect(world.players[0]!.homeTroops).toBeCloseTo(before + army, 0);
  });

  it("are asked to renew in the last 30 s; renewing needs both", () => {
    const world = allied();
    const alliance = [...world.alliances.values()][0]!;
    expect(rejection(send(world, 1, { type: "allianceRenew", ally: 2 }))).toBe(
      "too early to renew",
    );
    run(world, alliance.expiresTick - D.renewWindowTicks - world.tick);
    expect(rejection(send(world, 1, { type: "allianceRenew", ally: 2 }))).toBeNull();
    const renewed = send(world, 2, { type: "allianceRenew", ally: 1 });
    expect(renewed).toContainEqual({ type: "allianceRenewed", a: 1, b: 2 });
    const expires = alliance.expiresTick;

    // Next time only one of them renews: the alliance ends on time, nobody is a traitor.
    run(world, expires - D.renewWindowTicks - world.tick);
    send(world, 2, { type: "allianceRenew", ally: 1 });
    const events = run(world, expires - world.tick);
    expect(events).toContainEqual({ type: "allianceEnded", a: 1, b: 2, reason: "expired" });
    expect(isAllied(world, 1, 2)).toBe(false);
    expect(isTraitor(world, world.players[1])).toBe(false);
  });

  it("who break the alliance are traitors for 30 s: cheaper to attack", () => {
    const world = allied();
    const events = send(world, 1, { type: "allianceBreak", ally: 2 });
    expect(events).toContainEqual({ type: "allianceBroken", breaker: 1, victim: 2 });
    const traitor = world.players[0]!;
    expect(traitor.betrayals).toBe(1);
    expect(isTraitor(world, traitor)).toBe(true);

    send(world, 2, { type: "attack", target: 1, focusTile: 4, percentBp: 5000 });
    const attack = world.attacks[0]!;
    const cost = tileCost(world, attack, 3);
    const until = traitor.traitorUntilTick;
    traitor.traitorUntilTick = -1;
    expect(cost / tileCost(world, attack, 3)).toBeCloseTo(D.traitorLoss, 9);
    traitor.traitorUntilTick = until;
    run(world, until - world.tick);
    expect(isTraitor(world, traitor)).toBe(false);
  });

  it("never encircle each other", () => {
    // Player 2's pocket inside player 1's land is enclosed by an ally only: safe.
    const world = worldFromAscii(
      `
      11111222
      12111222
      11111222
      `,
      { rules: RULES },
    );
    send(world, 1, { type: "allianceRequest", target: 2 });
    send(world, 2, { type: "allianceRequest", target: 1 });
    world.players[1]!.encircleDirty = true;
    run(world, RULES.encirclement.intervalTicks * 2);
    expect(ownersToAscii(world)).toBe(
      ascii(`
      11111222
      12111222
      11111222
      `),
    );
    // Once the alliance is broken, the pocket falls.
    send(world, 2, { type: "allianceBreak", ally: 1 });
    run(world, RULES.encirclement.intervalTicks * 2);
    expect(world.owner[9]).toBe(1);
  });

  it("lose their alliances when eliminated", () => {
    const world = allied();
    world.players[1]!.homeTroops = 0;
    for (let tile = 5; tile < 30; tile++) {
      if (world.owner[tile] === 2) world.owner[tile] = 0;
    }
    world.players[1]!.tiles = 0;
    const events = run(world, 1);
    expect(events).toContainEqual({ type: "allianceEnded", a: 1, b: 2, reason: "eliminated" });
    expect(world.alliances.size).toBe(0);
  });
});
