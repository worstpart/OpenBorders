/**
 * Milestone 3.3: the server's shape check, sending budgets, and the promise behind them —
 * no command that passes the check can crash a tick (fuzzed against a real game).
 */
import { describe, expect, it } from "vitest";
import type { Command, StampedCommand } from "../../src/sim/commands.ts";
import { isLand } from "../../src/sim/map/gameMap.ts";
import { generateMap } from "../../src/sim/map/generate.ts";
import { Rng } from "../../src/sim/math/rng.ts";
import { runTick } from "../../src/sim/tick.ts";
import { createWorld, type World } from "../../src/sim/world.ts";
import {
  COMMAND_LIMITS,
  COMMAND_SCHEMAS,
  CommandBudget,
  commandProblem,
  type Field,
} from "../../src/server/validate.ts";

describe("the shape check", () => {
  it("accepts every well-formed command the client sends", () => {
    const good: Command[] = [
      { type: "spawn", tile: 12 },
      { type: "confirmSpawn" },
      { type: "attack", target: 0, focusTile: 5, percentBp: 2500 },
      { type: "boat", target: 3, tile: 9, percentBp: 10_000 },
      { type: "allianceReply", from: 2, accept: false },
      { type: "donate", to: 2, resource: "gold", percentBp: 100 },
      { type: "build", buildingType: "silo", tile: 4 },
      { type: "buildWall", points: [1, 50, 99] },
      { type: "launchMissile", buildingId: 3, tile: 7, missile: "warhead" },
      { type: "moveWarship", warshipId: 1, tile: -1 },
      { type: "ping", tile: 3, kind: "defend" },
      { type: "emote", to: 0, emoji: 4 },
    ];
    for (const c of good) expect(commandProblem(c), c.type).toBeNull();
  });

  it("refuses unknown types, missing, extra or wrongly typed fields and out-of-range values", () => {
    expect(commandProblem({ type: "testFlight", from: 1, to: 2 })).toMatch(/unknown/);
    expect(commandProblem({ type: "__proto__" })).toMatch(/unknown/);
    expect(commandProblem({ type: "toString" })).toMatch(/unknown/);
    expect(commandProblem({ type: "spawn" })).toMatch(/bad tile/);
    expect(commandProblem({ type: "spawn", tile: 1, playerId: 2 })).toMatch(/unexpected field/);
    expect(commandProblem({ type: "spawn", tile: "1" })).toMatch(/bad tile/);
    expect(commandProblem({ type: "spawn", tile: 1.5 })).toMatch(/bad tile/);
    expect(commandProblem({ type: "spawn", tile: -1 })).toMatch(/bad tile/);
    expect(commandProblem({ type: "spawn", tile: 2 ** 40 })).toMatch(/bad tile/);
    expect(commandProblem({ type: "attack", target: 0, focusTile: 5, percentBp: 10_001 })).toMatch(
      /percentBp/,
    );
    expect(commandProblem({ type: "allianceReply", from: 2, accept: 1 })).toMatch(/accept/);
    expect(commandProblem({ type: "build", buildingType: "castle", tile: 4 })).toMatch(
      /buildingType/,
    );
    expect(commandProblem({ type: "buildWall", points: [1] })).toMatch(/points/);
    expect(commandProblem({ type: "buildWall", points: new Array(33).fill(1) })).toMatch(/points/);
    expect(commandProblem({ type: "buildWall", points: [1, "2"] })).toMatch(/points/);
    expect(commandProblem([1, 2])).toMatch(/not a command/);
  });
});

describe("sending budgets", () => {
  it("allows a burst, refills over time, drops the excess and closes a flood", () => {
    let now = 0;
    const budget = new CommandBudget(() => now);
    for (let k = 0; k < COMMAND_LIMITS.burst; k++) expect(budget.take()).toBe("ok");
    expect(budget.take()).toBe("drop");
    now += 1000; // one second refills perSecond
    for (let k = 0; k < COMMAND_LIMITS.perSecond; k++) expect(budget.take()).toBe("ok");
    expect(budget.take()).toBe("drop");
    let verdict = "drop";
    for (let k = 0; k < COMMAND_LIMITS.maxDropped && verdict !== "kick"; k++) {
      verdict = budget.take();
    }
    expect(verdict).toBe("kick");
  });

  it("a human clicking fast (8 a second for a minute) is never limited", () => {
    let now = 0;
    const budget = new CommandBudget(() => now);
    for (let k = 0; k < 480; k++) {
      now += 125;
      expect(budget.take()).toBe("ok");
    }
  });

  it("closes a connection after repeated malformed commands", () => {
    const budget = new CommandBudget(() => 0);
    let verdict = "drop";
    for (let k = 0; k <= COMMAND_LIMITS.maxMalformed; k++) verdict = budget.strike();
    expect(verdict).toBe("kick");
  });
});

// --- Fuzz: nothing that passes the check can crash a tick ------------------------------

const EDGE_INTS = [0, 1, 2, 3, -1, 0x7fffffff, 0xffff, 0xffffff];

function randomValue(rng: Rng, field: Field, world: World): unknown {
  if ("bool" in field) return rng.nextInt(2) === 1;
  if ("oneOf" in field) return field.oneOf[rng.nextInt(field.oneOf.length)];
  const randomInt = ([min, max]: readonly [number, number]) => {
    const pick = rng.nextInt(4);
    // Edge values, tiles of this map, small ids that exist, and anything in range.
    const candidate =
      pick === 0
        ? EDGE_INTS[rng.nextInt(EDGE_INTS.length)]!
        : pick === 1
          ? rng.nextInt(world.owner.length)
          : pick === 2
            ? rng.nextInt(12)
            : min + rng.nextInt(Math.min(max - min + 1, 0x7fffffff));
    return Math.max(min, Math.min(max, candidate));
  };
  if ("int" in field) return randomInt(field.int);
  const length = field.length[0] + rng.nextInt(field.length[1] - field.length[0] + 1);
  return Array.from({ length }, () => randomInt(field.ints));
}

function randomCommand(rng: Rng, world: World): Command {
  const types = Object.keys(COMMAND_SCHEMAS) as (keyof typeof COMMAND_SCHEMAS)[];
  const type = types[rng.nextInt(types.length)]!;
  const command: Record<string, unknown> = { type };
  for (const [key, field] of Object.entries(COMMAND_SCHEMAS[type])) {
    command[key] = randomValue(rng, field, world);
  }
  expect(commandProblem(command)).toBeNull();
  return command as unknown as Command;
}

function fuzzGame(seed: number): number[] {
  const map = generateMap({ seed: 9, width: 260, height: 180, style: "archipelago" });
  const world = createWorld({
    seed,
    map,
    players: [
      { name: "A", kind: "human" },
      { name: "B", kind: "human" },
      ...Array.from({ length: 4 }, (_, k) => ({ name: `N${k}`, kind: "bot" as const })),
      ...Array.from({ length: 6 }, (_, k) => ({
        name: `T${k}`,
        kind: "bot" as const,
        tier: "tribe" as const,
      })),
    ],
  });
  const rng = new Rng(seed);
  const land = (from: number) => {
    for (let t = from; t < world.owner.length; t++) {
      if (isLand(map, t) && world.owner[t] === 0) return t;
    }
    return 0;
  };
  const hashes: number[] = [];
  for (let tick = 1; tick <= 700; tick++) {
    const commands: StampedCommand[] = [];
    // Real spawns first, so the garbage also hits players with land, armies and gold.
    if (tick === 2) {
      commands.push({ playerId: 1, command: { type: "spawn", tile: land(9000) } });
      commands.push({ playerId: 2, command: { type: "spawn", tile: land(30000) } });
    }
    if (tick === 4) {
      commands.push({ playerId: 1, command: { type: "confirmSpawn" } });
      commands.push({ playerId: 2, command: { type: "confirmSpawn" } });
    }
    if (tick > 4) {
      for (let k = 0; k < 6; k++) {
        commands.push({ playerId: 1 + rng.nextInt(2), command: randomCommand(rng, world) });
      }
    }
    // Plenty of gold so builds, upgrades, walls and missiles really happen.
    if (tick === 300) for (const p of world.players) p.gold += 5_000_000;
    hashes.push(runTick(world, { tick, commands }).hash);
  }
  return hashes;
}

describe("fuzz: no command that passes the check can crash a tick", () => {
  it("4,000 random well-formed commands from two players: every tick runs, deterministically", () => {
    const first = fuzzGame(5);
    expect(first).toHaveLength(700);
    expect(fuzzGame(5)).toEqual(first); // garbage in, still the same game everywhere
  });
});
