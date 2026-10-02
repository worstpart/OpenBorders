import { describe, expect, it } from "vitest";
import type { Command } from "../../../src/sim/commands.ts";
import type { SimEvent } from "../../../src/sim/events.ts";
import { tileAt } from "../../../src/sim/map/gameMap.ts";
import { makeRules } from "../../../src/sim/rules.ts";
import { runTick } from "../../../src/sim/tick.ts";
import type { PlayerId, World } from "../../../src/sim/world.ts";
import { worldFromAscii } from "../../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
});

function run(
  world: World,
  ticks: number,
  commands: { player: PlayerId; command: Command }[] = [],
): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const frame = runTick(world, {
      tick: world.tick + 1,
      commands: k === 0 ? commands.map((c) => ({ playerId: c.player, command: c.command })) : [],
    });
    events.push(...frame.events);
  }
  return events;
}

const attack = (world: World, target: PlayerId, x: number, y: number, percentBp = 10_000) => ({
  type: "attack" as const,
  target,
  focusTile: tileAt(world.map, x, y),
  percentBp,
});

describe("elimination", () => {
  it("a player who loses their last tile is out; their armies are lost, attackers go home", () => {
    const world = worldFromAscii(
      `
      ~~~~~~~~~~
      ~1112....~
      ~~~~~~~~~~
      `,
      { rules: RULES, homeTroops: [100_000, 100] },
    );
    // Player 2 sends a tiny, crawling expansion east; player 1 overruns player 2.
    const events = run(world, 15, [
      { player: 2, command: attack(world, 0, 8, 1, 1_000) },
      { player: 1, command: attack(world, 2, 4, 1, 5_000) },
    ]);
    const loser = world.players[1]!;
    expect(loser.alive).toBe(false);
    expect(loser.tiles).toBe(0);
    expect(loser.homeTroops + loser.fieldTroops).toBe(0);
    expect(events).toContainEqual({ type: "eliminated", playerId: 2, by: 1 });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "attackEnded",
        attacker: 2,
        reason: "eliminated",
        survivors: 0,
      }),
    );
    expect(world.attacks.filter((a) => a.attacker === 1 && a.target === 2)).toEqual([]);
    expect(world.players[0]!.fieldTroops).toBe(0);
  });

  // Player 2 holds 33 tiles; player 1 (18 tiles) borders them along a long front.
  const REMNANT = `
    ~~~~~~~~~~~~~~
    ~111222222222~
    ~111222222222~
    ~111222222222~
    ~11122~~~~~~~~
    ~11122~~~~~~~~
    ~11122~~~~~~~~
    ~~~~~~~~~~~~~~
  `;

  it("a collapsed remnant under attack is absorbed by the attacker", () => {
    const world = worldFromAscii(REMNANT, { rules: RULES, homeTroops: [1_000, 1_000_000] });
    world.players[1]!.peakTiles = 200; // they once held much more
    // A hopeless attack: it barely moves, but player 2 is now "under attack".
    const events = run(world, 2, [{ player: 1, command: attack(world, 2, 8, 2, 1_000) }]);
    expect(world.players[1]!.alive).toBe(false);
    expect(world.players[0]!.tiles).toBe(18 + 33);
    expect(events).toContainEqual({ type: "eliminated", playerId: 2, by: 1 });
  });

  it("a fresh start that lost a few tiles is not absorbed", () => {
    const world = worldFromAscii(REMNANT, { rules: RULES, homeTroops: [1_000, 1_000_000] });
    world.players[1]!.peakTiles = 49; // 33 tiles is still most of a fresh 49-tile start
    run(world, 2, [{ player: 1, command: attack(world, 2, 8, 2, 1_000) }]);
    expect(world.players[1]!.alive).toBe(true);
    expect(world.players[1]!.tiles).toBe(33);
  });

  it("a small remnant nobody is attacking stays in the game", () => {
    const world = worldFromAscii(REMNANT, { rules: RULES, homeTroops: [1_000, 1_000_000] });
    world.players[1]!.peakTiles = 200;
    run(world, 2);
    expect(world.players[1]!.alive).toBe(true);
  });

  it("tracks the most land each player ever held", () => {
    const world = worldFromAscii(REMNANT, { rules: RULES });
    run(world, 1);
    expect(world.players.map((p) => p.peakTiles)).toEqual([18, 33]);
  });
});
