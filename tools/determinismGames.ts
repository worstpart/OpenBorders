// Cross-engine determinism games (milestone 3.0, D-006). Pure module: no Node and no DOM
// APIs, so Node (tools/crossEngine.ts — what the server will run) and a browser (imported
// through the dev server: `await import("/tools/determinismGames.ts")`) play the very same
// games and can compare the results line by line.
//
// Each game: a generated map, nations and tribes plus a scripted human, played for `ticks`
// ticks. Reported: a digest of every tick's state hash, the hash every 500 ticks, and a key of
// the snapshot text at the halfway tick (equal keys = a snapshot made by one engine is exactly
// the one the other would make).
import type { StampedCommand } from "../src/sim/commands.ts";
import { isLand } from "../src/sim/map/gameMap.ts";
import { generateMap, type MapSpec } from "../src/sim/map/generate.ts";
import { Hasher } from "../src/sim/math/hash.ts";
import { deserializeWorld, serializeWorld, type WorldSnapshot } from "../src/sim/snapshot.ts";
import { runTick } from "../src/sim/tick.ts";
import { createWorld, type PlayerSetup, type World } from "../src/sim/world.ts";

export interface DeterminismConfig {
  readonly name: string;
  readonly map: MapSpec;
  readonly nations: number;
  readonly tribes: number;
  readonly teams: number;
  readonly difficulty: "easy" | "medium" | "hard";
}

export const CONFIGS: readonly DeterminismConfig[] = [
  {
    name: "islands",
    map: { seed: 2, width: 1100, height: 700, style: "archipelago" },
    nations: 8,
    tribes: 10,
    teams: 0,
    difficulty: "hard",
  },
  {
    name: "continent",
    map: { seed: 4, width: 1100, height: 700, style: "continent" },
    nations: 10,
    tribes: 40,
    teams: 0,
    difficulty: "medium",
  },
  {
    name: "twinTeams",
    map: { seed: 6, width: 1100, height: 700, style: "twin" },
    nations: 8,
    tribes: 10,
    teams: 2,
    difficulty: "hard",
  },
];

export interface DeterminismResult {
  readonly config: string;
  readonly seed: number;
  readonly ticks: number;
  /** Folds every tick's state hash. */
  readonly digest: number;
  /** [tick, hash] every 500 ticks. */
  readonly checkpoints: readonly (readonly [number, number])[];
  /** Hash of the snapshot JSON text at the halfway tick. */
  readonly snapshotKey: number;
  /** The game also continued, in this engine, from that snapshot rebuilt: same digest? */
  readonly resumedMatches: boolean;
}

function players(config: DeterminismConfig): PlayerSetup[] {
  return [
    { name: "You", kind: "human" },
    ...Array.from({ length: config.nations }, (_, k) => ({
      name: `Nation ${k + 1}`,
      kind: "bot" as const,
      difficulty: config.difficulty,
      team: config.teams > 0 ? (k % config.teams) + 1 : 0,
    })),
    ...Array.from({ length: config.tribes }, (_, k) => ({
      name: `Tribe ${k + 1}`,
      kind: "bot" as const,
      tier: "tribe" as const,
    })),
  ];
}

/** The scripted human: spawns, then expands into neutral land every 40 ticks. */
function human(world: World): StampedCommand[] {
  const me = world.players[0]!;
  if (world.tick === 3) {
    for (let tile = (world.owner.length >> 1) + 37; tile < world.owner.length; tile++) {
      if (isLand(world.map, tile) && world.owner[tile] === 0) {
        return [{ playerId: 1, command: { type: "spawn", tile } }];
      }
    }
  }
  if (world.tick === 5) return [{ playerId: 1, command: { type: "confirmSpawn" } }];
  if (!me.alive || world.tick % 40 !== 0) return [];
  const { width } = world.map;
  for (const tile of me.border) {
    for (const n of [tile - 1, tile + 1, tile - width, tile + width]) {
      if (n >= 0 && n < world.owner.length && isLand(world.map, n) && world.owner[n] !== 1) {
        const target = world.owner[n]!;
        return [
          { playerId: 1, command: { type: "attack", target, focusTile: n, percentBp: 4_000 } },
        ];
      }
    }
  }
  return [];
}

function textKey(text: string): number {
  return new Hasher().addString(text).digest();
}

/** Plays one game; `config` by name (see CONFIGS). */
export function playDeterminismGame(
  configName: string,
  seed: number,
  ticks: number,
): DeterminismResult {
  const config = CONFIGS.find((c) => c.name === configName);
  if (!config) throw new Error(`unknown config ${configName}`);
  const map = generateMap(config.map);
  const setup = players(config);
  const world = createWorld({ seed, map, players: setup });
  const half = Math.floor(ticks / 2);
  const checkpoints: [number, number][] = [];
  let digest = 0;
  let digestAtHalf = 0;
  let snapshotText = "";
  while (world.tick < ticks && world.phase !== "ended") {
    const hash = runTick(world, { tick: world.tick + 1, commands: human(world) }).hash;
    digest = (Math.imul(digest ^ hash, 0x9e3779b1) + world.tick) >>> 0;
    if (world.tick % 500 === 0) checkpoints.push([world.tick, hash]);
    if (world.tick === half) {
      snapshotText = JSON.stringify(serializeWorld(world));
      digestAtHalf = digest;
    }
  }

  // Resume from the halfway snapshot on a fresh map and fold the remaining ticks the same way.
  let resumedMatches = snapshotText === "";
  if (snapshotText !== "") {
    const copy = deserializeWorld(
      JSON.parse(snapshotText) as WorldSnapshot,
      generateMap(config.map),
    );
    let resumed = digestAtHalf;
    while (copy.tick < world.tick) {
      const hash = runTick(copy, { tick: copy.tick + 1, commands: human(copy) }).hash;
      resumed = (Math.imul(resumed ^ hash, 0x9e3779b1) + copy.tick) >>> 0;
    }
    resumedMatches = resumed === digest;
  }
  return {
    config: configName,
    seed,
    ticks: world.tick,
    digest,
    checkpoints,
    snapshotKey: textKey(snapshotText),
    resumedMatches,
  };
}
