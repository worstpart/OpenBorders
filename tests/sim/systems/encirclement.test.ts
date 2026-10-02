import { describe, expect, it } from "vitest";
import type { Command } from "../../../src/sim/commands.ts";
import type { SimEvent } from "../../../src/sim/events.ts";
import { tileAt } from "../../../src/sim/map/gameMap.ts";
import { makeRules } from "../../../src/sim/rules.ts";
import { runTick } from "../../../src/sim/tick.ts";
import type { PlayerId, World } from "../../../src/sim/world.ts";
import { ascii, ownersToAscii, worldFromAscii } from "../../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseTicks: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
});

/** Runs a full encirclement interval (every player gets checked once); returns all events. */
function runInterval(
  world: World,
  commands: { player: PlayerId; command: Command }[] = [],
): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < RULES.encirclement.intervalTicks; k++) {
    const frame = runTick(world, {
      tick: world.tick + 1,
      commands: k === 0 ? commands.map((c) => ({ playerId: c.player, command: c.command })) : [],
    });
    events.push(...frame.events);
  }
  return events;
}

describe("encirclement", () => {
  it("land enclosed by a single player falls to them", () => {
    const world = worldFromAscii(
      `
      ~~~~~~~
      ~11111~
      ~12211~
      ~11111~
      ~~~~~~~
      `,
      { rules: RULES },
    );
    const events = runInterval(world);
    expect(ownersToAscii(world)).toBe(
      ascii(`
        ~~~~~~~
        ~11111~
        ~11111~
        ~11111~
        ~~~~~~~
      `),
    );
    expect(events).toContainEqual({ type: "encircled", playerId: 2, by: 1, tiles: 2 });
    expect(events).toContainEqual({ type: "eliminated", playerId: 2, by: 1 });
  });

  it("coasts are safe", () => {
    const world = worldFromAscii(
      `
      ~~~~~~
      ~1112~
      ~1112~
      ~~~~~~
      `,
      { rules: RULES },
    );
    runInterval(world);
    expect(world.players[1]!.tiles).toBe(2);
  });

  it("touching neutral land is safe", () => {
    const world = worldFromAscii(
      `
      ~~~~~~~~
      ~111111~
      ~1122.1~
      ~111111~
      ~~~~~~~~
      `,
      { rules: RULES },
    );
    runInterval(world);
    expect(world.players[1]!.tiles).toBe(2);
  });

  it("a main territory surrounded by two players survives; a cut-off pocket falls", () => {
    const world = worldFromAscii(
      `
      ~~~~~~~~~~
      ~11113333~
      ~12223233~
      ~12223333~
      ~11113333~
      ~~~~~~~~~~
      `,
      { rules: RULES },
    );
    const events = runInterval(world);
    expect(ownersToAscii(world)).toBe(
      ascii(`
        ~~~~~~~~~~
        ~11113333~
        ~12223333~
        ~12223333~
        ~11113333~
        ~~~~~~~~~~
      `),
    );
    expect(events).toContainEqual({ type: "encircled", playerId: 2, by: 3, tiles: 1 });
  });

  // Player 2's pocket at (3,2) touches player 1 on three sides and player 3 on one;
  // player 2's main territory runs along the south coast, so it's safe.
  const CONTESTED = `
    ~~~~~~~~
    ~111333~
    ~112333~
    ~111333~
    ~222222~
    ~~~~~~~~
  `;

  it("several enclosers: the longest shared border takes the pocket", () => {
    const world = worldFromAscii(CONTESTED, { rules: RULES });
    runInterval(world);
    expect(world.owner[tileAt(world.map, 3, 2)]).toBe(1);
  });

  it("several enclosers: an attacker of the player takes the pocket first", () => {
    const world = worldFromAscii(CONTESTED, {
      rules: RULES,
      homeTroops: [1_000, 1_000_000, 1_000],
    });
    // A hopeless attack by player 3 (it barely moves, but it is active).
    const events = runInterval(world, [
      {
        player: 3,
        command: {
          type: "attack",
          target: 2,
          focusTile: tileAt(world.map, 3, 2),
          percentBp: 1_000,
        },
      },
    ]);
    expect(world.attacks).toHaveLength(1);
    expect(world.owner[tileAt(world.map, 3, 2)]).toBe(3);
    expect(events).toContainEqual({ type: "encircled", playerId: 2, by: 3, tiles: 1 });
  });

  it("settles: once nothing changes around a player, checks are skipped", () => {
    const world = worldFromAscii(CONTESTED, { rules: RULES });
    runInterval(world); // the pocket falls, which marks the neighbours as changed
    runInterval(world); // they are checked once more and found safe
    expect(world.players.every((p) => !p.encircleDirty)).toBe(true);
    const events = runInterval(world);
    expect(events.filter((e) => e.type === "encircled")).toEqual([]);
    expect(world.players.every((p) => !p.encircleDirty)).toBe(true);
  });
});
