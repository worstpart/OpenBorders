import { describe, expect, it } from "vitest";
import type { TickFrame } from "../../../src/sim/frame.ts";
import { tileAt } from "../../../src/sim/map/gameMap.ts";
import { DEFAULT_RULES, makeRules } from "../../../src/sim/rules.ts";
import { winLandShare } from "../../../src/sim/systems/victory.ts";
import { runTick } from "../../../src/sim/tick.ts";
import type { World } from "../../../src/sim/world.ts";
import { worldFromAscii } from "../../helpers/asciiMap.ts";

const RULES = makeRules({ attack: { noiseShare: 0 }, troops: { growthFloor: 0, growthScale: 0 } });

function runUntilOver(world: World, maxTicks = 500): TickFrame[] {
  const frames: TickFrame[] = [];
  while (world.phase !== "ended" && frames.length < maxTicks) {
    frames.push(runTick(world, { tick: world.tick + 1, commands: [] }));
  }
  return frames;
}

describe("victory", () => {
  it("holding 70% of the land wins", () => {
    // 20 land tiles: player 1 holds 12 and expands; 14 tiles (70%) wins.
    const world = worldFromAscii(
      `
      ~~~~~~~~~~~~
      ~111111....~
      ~111111..22~
      ~~~~~~~~~~~~
      `,
      { rules: RULES, homeTroops: [10_000, 10_000] },
    );
    runTick(world, {
      tick: 1,
      commands: [
        {
          playerId: 1,
          command: {
            type: "attack",
            target: 0,
            focusTile: tileAt(world.map, 7, 1),
            percentBp: 5_000,
          },
        },
      ],
    });
    const frames = runUntilOver(world);
    const last = frames.at(-1)!;
    expect(last.phase).toBe("ended");
    expect(last.winner).toBe(1);
    expect(last.events).toContainEqual({ type: "gameOver", winner: 1, reason: "landShare" });
    expect(world.players[0]!.tiles).toBe(14);
    // Armies stop and come home when the match ends.
    expect(last.attacks).toEqual([]);
    expect(world.players[0]!.fieldTroops).toBe(0);
  });

  it("the last player standing wins", () => {
    const world = worldFromAscii(
      `
      ~~~~~~~
      ~11112~
      ~~~~~~~
      `,
      { rules: makeRules({ ...RULES, victory: { landShare: 2 } }), homeTroops: [10_000, 1] },
    );
    runTick(world, {
      tick: 1,
      commands: [
        {
          playerId: 1,
          command: {
            type: "attack",
            target: 2,
            focusTile: tileAt(world.map, 5, 1),
            percentBp: 5_000,
          },
        },
      ],
    });
    const last = runUntilOver(world).at(-1)!;
    expect(last.winner).toBe(1);
    expect(last.events).toContainEqual({ type: "gameOver", winner: 1, reason: "lastStanding" });
  });

  it("anti-stall: the land needed to win drops after 15 minutes, down to 50%", () => {
    const share = (ticks: number): number => Math.round(winLandShare(DEFAULT_RULES, ticks) * 100);
    expect(share(0)).toBe(70);
    expect(share(9_000)).toBe(70); // 15:00
    expect(share(9_299)).toBe(70);
    expect(share(9_300)).toBe(69); // 15:30
    expect(share(12_000)).toBe(60); // 20:00
    expect(share(15_000)).toBe(50); // 25:00
    expect(share(60_000)).toBe(50);
  });

  it("a stalled duel is won by the bigger player once the requirement drops to their share", () => {
    // 11 of 20 tiles (55%) against 9: no one wins at 70%, nobody attacks.
    const world = worldFromAscii(
      `
      ~~~~~~~~~~~~
      ~1111112222~
      ~1111122222~
      ~~~~~~~~~~~~
      `,
      {
        rules: makeRules({
          ...RULES,
          victory: { declineStartTicks: 10, declineStepTicks: 5, declineStep: 0.05 },
        }),
        homeTroops: [100, 100],
      },
    );
    world.playStartTick = world.tick;
    const frames = runUntilOver(world, 100);
    // 70% → 55% takes 3 steps: 10 + 3 × 5 ticks of play.
    expect(world.tick).toBe(25);
    expect(frames.at(-1)!.events).toContainEqual({
      type: "gameOver",
      winner: 1,
      reason: "landShare",
    });
  });

  it("nothing moves once the game is over", () => {
    const world = worldFromAscii("11111111..", { rules: RULES, homeTroops: [10_000] });
    runTick(world, { tick: 1, commands: [] });
    expect(world.phase).toBe("ended"); // 8 of 10 tiles: over at once
    const troops = world.players[0]!.homeTroops;
    const frame = runTick(world, {
      tick: 2,
      commands: [
        { playerId: 1, command: { type: "attack", target: 0, focusTile: 9, percentBp: 5_000 } },
      ],
    });
    expect(frame.events).toContainEqual(
      expect.objectContaining({ type: "commandRejected", reason: "the match hasn't started" }),
    );
    expect(world.players[0]!.homeTroops).toBe(troops);
    expect(frame.changedTiles.length).toBe(0);
  });
});
