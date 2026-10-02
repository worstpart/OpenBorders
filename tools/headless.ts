/**
 * Headless bots-only games (ROADMAP milestone 1.5; balance work in 1.7).
 *
 *   node tools/headless.ts [--games 20] [--bots 8] [--seed 1] [--map-seed 2]
 *                          [--width 1100 --height 700] [--max-minutes 60]
 *                          [--workers N] [--json out.json] [--quiet]
 *                          [--rules overrides.json] [--personality expander]
 *
 * Plays games with the real simulation (no browser) and reports how they went: winner
 * and reason, length, when the land race ended, lead changes, eliminations, rejected
 * commands, and simulation time per tick. Games run in parallel on worker threads — by
 * default one per physical core, minus one (more workers finish sooner but share cores,
 * which inflates the per-tick times). Each game is still single-threaded.
 *
 * --rules takes a JSON file of rule overrides, deep-merged into DEFAULT_RULES (e.g.
 * {"troops": {"growthFloor": 20}}), to try a balance change before editing rules.ts.
 * --personality gives every bot the same personality.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import type { GameMap } from "../src/sim/map/gameMap.ts";
import { generateContinent } from "../src/sim/map/generate.ts";
import {
  DEFAULT_RULES,
  PERSONALITIES,
  type GameRules,
  type Personality,
} from "../src/sim/rules.ts";
import { runTick } from "../src/sim/tick.ts";
import { createWorld, type World } from "../src/sim/world.ts";

interface Options {
  games: number;
  bots: number;
  firstSeed: number;
  mapSeed: number;
  width: number;
  height: number;
  maxTicks: number;
  rules: GameRules;
  personality: Personality | undefined;
}

export interface GameReport {
  seed: number;
  winner: string | null;
  winnerPersonality: string | null;
  reason: string;
  minutes: number;
  /** When all land was owned… */
  landRaceMinutes: number | null;
  /** …and when 90% of it was (the last stray corners can take a while). */
  land90Minutes: number | null;
  leadChanges: number;
  /** Whether the leader at minute 3 went on to win (null if the game ended sooner). */
  leaderAt3Won: boolean | null;
  eliminations: number;
  attacks: number;
  rejected: number;
  tickMs: { avg: number; p99: number; max: number };
  error: string | null;
}

const TICKS_PER_SECOND = 10;
const LEADER_SAMPLE_TICKS = 100;

if (isMainThread) await main();
else runWorker(workerData as { options: Options; seeds: number[] });

async function main(): Promise<void> {
  const { values: args } = parseArgs({
    options: {
      games: { type: "string", default: "20" },
      bots: { type: "string", default: "8" },
      seed: { type: "string", default: "1" },
      "map-seed": { type: "string", default: "2" },
      width: { type: "string", default: "1100" },
      height: { type: "string", default: "700" },
      "max-minutes": { type: "string", default: "60" },
      workers: { type: "string" },
      json: { type: "string" },
      quiet: { type: "boolean", default: false },
      rules: { type: "string" },
      personality: { type: "string" },
    },
  });
  const options: Options = {
    games: Number(args.games),
    bots: Number(args.bots),
    firstSeed: Number(args.seed),
    mapSeed: Number(args["map-seed"]),
    width: Number(args.width),
    height: Number(args.height),
    maxTicks: Number(args["max-minutes"]) * 60 * TICKS_PER_SECOND,
    rules: args.rules
      ? (merge(DEFAULT_RULES, JSON.parse(readFileSync(args.rules, "utf8"))) as GameRules)
      : DEFAULT_RULES,
    personality: parsePersonality(args.personality),
  };
  const workerCount = Math.max(
    1,
    Math.min(options.games, Number(args.workers ?? availableParallelism() / 2 - 1)),
  );
  const startedAt = performance.now();
  const reports: GameReport[] = [];

  // Deal seeds out round-robin; each worker plays its share and reports game by game.
  await Promise.all(
    Array.from({ length: workerCount }, (_, w) => {
      const seeds: number[] = [];
      for (let k = w; k < options.games; k += workerCount) seeds.push(options.firstSeed + k);
      return new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { options, seeds } });
        worker.on("message", (report: GameReport) => {
          reports.push(report);
          if (!args.quiet) console.log(describe(report, reports.length, options.games));
        });
        worker.on("error", reject);
        worker.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`worker exited with code ${code}`)),
        );
      });
    }),
  );
  reports.sort((a, b) => a.seed - b.seed);
  summarize(reports, options, workerCount, (performance.now() - startedAt) / 1000, args.json);
}

function runWorker({ options, seeds }: { options: Options; seeds: number[] }): void {
  const map = generateContinent({
    seed: options.mapSeed,
    width: options.width,
    height: options.height,
  });
  for (const seed of seeds) parentPort!.postMessage(playOne(map, options, seed));
}

function playOne(map: GameMap, options: Options, seed: number): GameReport {
  const world: World = createWorld({
    seed,
    map,
    rules: options.rules,
    players: Array.from({ length: options.bots }, (_, k) => ({
      name: `Bot ${k + 1}`,
      kind: "bot" as const,
      personality: options.personality,
    })),
  });
  const times: number[] = [];
  let leader = 0;
  let leadChanges = -1;
  let leaderAt3 = 0;
  let landRaceTick: number | null = null;
  let land90Tick: number | null = null;
  let eliminations = 0;
  let attacks = 0;
  let rejected = 0;
  let reason = "timeout";
  let error: string | null = null;

  try {
    while (world.phase !== "ended" && world.tick < options.maxTicks) {
      const startedAt = performance.now();
      const frame = runTick(world, { tick: world.tick + 1, commands: [] });
      times.push(performance.now() - startedAt);
      for (const event of frame.events) {
        if (event.type === "eliminated") eliminations++;
        else if (event.type === "attackStarted") attacks++;
        else if (event.type === "commandRejected") rejected++;
        else if (event.type === "gameOver") reason = event.reason;
      }
      if (world.tick % LEADER_SAMPLE_TICKS === 0) {
        const top = world.players.reduce((a, b) => (b.tiles > a.tiles ? b : a));
        if (top.id !== leader) {
          leader = top.id;
          leadChanges++;
        }
        if (leaderAt3 === 0 && world.tick - world.playStartTick >= 3 * 60 * TICKS_PER_SECOND) {
          leaderAt3 = leader;
        }
      }
      if (landRaceTick === null && world.playStartTick >= 0 && world.tick % 10 === 0) {
        const owned = world.players.reduce((sum, p) => sum + p.tiles, 0);
        if (land90Tick === null && owned >= 0.9 * map.landTiles) land90Tick = world.tick;
        if (owned >= map.landTiles) landRaceTick = world.tick;
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const winner = world.winner !== null ? world.players[world.winner - 1]! : null;
  const playTicks = world.tick - Math.max(0, world.playStartTick);
  return {
    seed,
    winner: winner?.name ?? null,
    winnerPersonality: winner?.brain?.personality ?? null,
    reason: error ? "error" : reason,
    minutes: round(playTicks / TICKS_PER_SECOND / 60),
    landRaceMinutes:
      landRaceTick === null ? null : round((landRaceTick - world.playStartTick) / 600),
    land90Minutes: land90Tick === null ? null : round((land90Tick - world.playStartTick) / 600, 2),
    leadChanges: Math.max(0, leadChanges),
    leaderAt3Won: leaderAt3 === 0 ? null : leaderAt3 === world.winner,
    eliminations,
    attacks,
    rejected,
    tickMs: {
      avg: round(times.reduce((s, t) => s + t, 0) / Math.max(1, times.length), 3),
      p99: round(sorted[Math.floor(sorted.length * 0.99)] ?? 0, 3),
      max: round(sorted.at(-1) ?? 0, 3),
    },
    error,
  };
}

function describe(report: GameReport, done: number, total: number): string {
  return (
    `game ${done}/${total} seed ${report.seed}: ${report.winner ?? "no winner"} ` +
    `(${report.winnerPersonality ?? "-"}) by ${report.reason} after ${report.minutes} min, ` +
    `land 90% ${report.land90Minutes ?? "-"} / all ${report.landRaceMinutes ?? "-"} min, ` +
    `${report.leadChanges} lead changes, ` +
    `tick avg ${report.tickMs.avg} / p99 ${report.tickMs.p99} / max ${report.tickMs.max} ms` +
    (report.error ? `\n  ERROR: ${report.error}` : "")
  );
}

function summarize(
  reports: GameReport[],
  options: Options,
  workers: number,
  seconds: number,
  jsonPath: string | undefined,
): void {
  const finished = reports.filter((r) => r.winner !== null);
  const minutes = finished.map((r) => r.minutes).sort((a, b) => a - b);
  const wins = new Map<string, number>();
  for (const r of finished) {
    wins.set(r.winnerPersonality ?? "?", (wins.get(r.winnerPersonality ?? "?") ?? 0) + 1);
  }
  const leaderKnown = reports.filter((r) => r.leaderAt3Won !== null);
  const summary = {
    games: options.games,
    bots: options.bots,
    map: `${options.width}x${options.height} seed ${options.mapSeed}`,
    finishedWithWinner: finished.length,
    errors: reports.filter((r) => r.error).length,
    timeouts: reports.filter((r) => r.reason === "timeout").length,
    minutes: {
      min: minutes[0] ?? null,
      median: minutes[Math.floor(minutes.length / 2)] ?? null,
      max: minutes.at(-1) ?? null,
    },
    landRaceMedianMinutes: {
      land90: median(reports.map((r) => r.land90Minutes)),
      allLand: median(reports.map((r) => r.landRaceMinutes)),
    },
    lengthHistogram: histogram(minutes, [8, 12, 16, 20, 30]),
    leaderAt3WinsShare: leaderKnown.length
      ? round(leaderKnown.filter((r) => r.leaderAt3Won).length / leaderKnown.length, 2)
      : null,
    winsByPersonality: Object.fromEntries(wins),
    rejectedCommands: reports.reduce((s, r) => s + r.rejected, 0),
    tickMs: {
      avg: round(reports.reduce((s, r) => s + r.tickMs.avg, 0) / Math.max(1, reports.length), 3),
      worstP99: Math.max(...reports.map((r) => r.tickMs.p99)),
      worstMax: Math.max(...reports.map((r) => r.tickMs.max)),
    },
    workers,
    wallClockSeconds: round(seconds),
  };
  console.log("\nSummary");
  console.log(JSON.stringify(summary, null, 2));
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ summary, reports }, null, 2));
  process.exitCode = summary.errors > 0 || summary.finishedWithWinner < options.games ? 1 : 0;
}

function median(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return known[Math.floor(known.length / 2)] ?? null;
}

/** Counts per bucket: "<8", "8-12", …, "30+". */
function histogram(sorted: number[], edges: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of sorted) {
    const k = edges.findIndex((edge) => value < edge);
    const label =
      k === 0 ? `<${edges[0]}` : k < 0 ? `${edges.at(-1)}+` : `${edges[k - 1]}-${edges[k]}`;
    out[label] = (out[label] ?? 0) + 1;
  }
  return out;
}

/** Deep-merges plain objects: `patch` values replace `base` values, objects merge. */
function merge(base: unknown, patch: unknown): unknown {
  if (typeof base !== "object" || base === null || typeof patch !== "object" || patch === null) {
    return patch;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in out)) throw new Error(`unknown rule "${key}"`);
    out[key] = merge(out[key], value);
  }
  return out;
}

function parsePersonality(value: string | undefined): Personality | undefined {
  if (value === undefined) return undefined;
  if (!(PERSONALITIES as readonly string[]).includes(value)) {
    throw new Error(`unknown personality "${value}" (one of ${PERSONALITIES.join(", ")})`);
  }
  return value as Personality;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
