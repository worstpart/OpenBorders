/**
 * Command logs (Phase 3, milestone 3.0): a whole game as its seed, its players and the
 * commands each turn carried. Bots decide inside the simulation, so these few commands are
 * all it takes to play the game again exactly. The server will keep one per game; a client
 * that reconnects gets a snapshot plus the turns since (D-006). Checkpoint hashes let a
 * replay say on which tick it went its own way.
 */
import type { StampedCommand, Turn } from "./commands.ts";
import type { GameMap } from "./map/gameMap.ts";
import { DEFAULT_RULES, type GameRules } from "./rules.ts";
import { runTick } from "./tick.ts";
import { createWorld, type PlayerSetup, type World } from "./world.ts";

export interface CommandLog {
  readonly seed: number;
  readonly players: readonly PlayerSetup[];
  /** The turns that carried commands, by ascending tick (empty turns are left out). */
  readonly turns: readonly Turn[];
  /** The last tick played. */
  readonly endTick: number;
  /** [tick, state hash after that tick], every `checkpointEvery` ticks and at the end. */
  readonly checkpoints: readonly (readonly [number, number])[];
}

/** Writes a CommandLog while a game is played: call `record` after every tick. */
export class CommandRecorder {
  private readonly turns: Turn[] = [];
  private readonly checkpoints: [number, number][] = [];
  private endTick = 0;
  private lastHash = 0;
  private readonly seed: number;
  private readonly players: readonly PlayerSetup[];
  private readonly checkpointEvery: number;

  constructor(seed: number, players: readonly PlayerSetup[], checkpointEvery = 100) {
    this.seed = seed;
    this.players = players;
    this.checkpointEvery = checkpointEvery;
  }

  /** The turn just played and the frame hash it produced. */
  record(turn: Turn, hash: number): void {
    if (turn.tick !== this.endTick + 1) {
      throw new Error(`CommandRecorder: tick ${turn.tick} after ${this.endTick}`);
    }
    if (turn.commands.length > 0) {
      this.turns.push({ tick: turn.tick, commands: turn.commands.map(copyCommand) });
    }
    this.endTick = turn.tick;
    this.lastHash = hash;
    if (turn.tick % this.checkpointEvery === 0) this.checkpoints.push([turn.tick, hash]);
  }

  log(): CommandLog {
    const checkpoints = this.checkpoints.slice();
    if (this.endTick > 0 && checkpoints.at(-1)?.[0] !== this.endTick) {
      checkpoints.push([this.endTick, this.lastHash]);
    }
    return {
      seed: this.seed,
      players: this.players.slice(),
      turns: this.turns.slice(),
      endTick: this.endTick,
      checkpoints,
    };
  }
}

// Commands are plain data; a deep copy keeps the log safe from later edits by the caller.
function copyCommand(command: StampedCommand): StampedCommand {
  return JSON.parse(JSON.stringify(command)) as StampedCommand;
}

export interface ReplayResult {
  readonly world: World;
  /** The first checkpoint whose hash differed, or null if every one matched. */
  readonly divergedAt: number | null;
}

/**
 * Plays a logged game again on `map` with `rules`. With `from` (a world rebuilt from a
 * snapshot of this game), it continues from that world's tick instead of the start — the
 * reconnect path. `until` stops early.
 */
export function replayLog(
  log: CommandLog,
  map: GameMap,
  rules: GameRules = DEFAULT_RULES,
  options: { from?: World; until?: number } = {},
): ReplayResult {
  const world = options.from ?? createWorld({ seed: log.seed, map, rules, players: log.players });
  const until = Math.min(options.until ?? log.endTick, log.endTick);
  const checkpoints = new Map(log.checkpoints.map(([tick, hash]) => [tick, hash]));
  let next = firstTurnAfter(log.turns, world.tick);
  let divergedAt: number | null = null;
  while (world.tick < until) {
    const tick = world.tick + 1;
    const turn = log.turns[next];
    const commands = turn && turn.tick === tick ? turn.commands : [];
    if (commands.length > 0) next++;
    const frame = runTick(world, { tick, commands });
    const expected = checkpoints.get(tick);
    if (divergedAt === null && expected !== undefined && expected !== frame.hash) {
      divergedAt = tick;
    }
  }
  return { world, divergedAt };
}

/** Index of the first logged turn after `tick` (binary search; turns are by ascending tick). */
function firstTurnAfter(turns: readonly Turn[], tick: number): number {
  let lo = 0;
  let hi = turns.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (turns[mid]!.tick <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
