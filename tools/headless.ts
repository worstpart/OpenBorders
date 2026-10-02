/**
 * Headless bots-only games (ROADMAP milestone 1.5; balance work in 1.7).
 *
 *   node tools/headless.ts [--games 20] [--bots 8] [--tribes 0] [--difficulty hard]
 *                          [--seed 1] [--map-seed 2]
 *                          [--width 1100 --height 700] [--max-minutes 60]
 *                          [--workers N] [--json out.json] [--quiet]
 *                          [--rules overrides.json] [--personality expander]
 *                          [--no-alliances] [--teams N] [--no-economy] [--no-buildings]
 *
 * Plays games with the real simulation (no browser) and reports how they went: winner
 * and reason, length, when the land race ended, lead changes, eliminations, rejected
 * commands, and simulation time per tick. Games run in parallel on worker threads — by
 * default one per physical core, minus one (more workers finish sooner but share cores,
 * which inflates the per-tick times). Each game is still single-threaded.
 *
 * --rules takes a JSON file of rule overrides, deep-merged into DEFAULT_RULES (e.g.
 * {"troops": {"growthFloor": 20}}), to try a balance change before editing rules.ts.
 * --personality gives every nation the same personality. --bots is the number of nations
 * (the smart bots of GAME_DESIGN §3.11/§3.13); --tribes adds that many weak filler bots.
 * --no-alliances turns diplomacy off (GAME_DESIGN §3.14): games then play as before 2.2.
 * --teams N deals the nations round-robin into N teams (GAME_DESIGN §3.15; tribes have no
 * team); the report then counts wins by team and checks that teammates never fight.
 * --no-economy turns gold off (GAME_DESIGN §3.16): games then play as in 2.3. Each game
 * reports gold earned, mobilized, donated and looted, and the median income of the
 * nations alive at minutes 1, 3 and 6.
 * --no-buildings turns buildings off (GAME_DESIGN §3.17): games then play as in 2.4. Each
 * game reports builds, upgrades, gold spent on them, captures, and when the first level
 * I / II / III building was finished.
 *
 * Tick times are also broken down per system (`systemsMs`: average and worst per step,
 * plus the steps of each game's slowest tick) to show where the time goes.
 */
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import type { GameMap } from "../src/sim/map/gameMap.ts";
import { generateContinent } from "../src/sim/map/generate.ts";
import {
  DIFFICULTIES,
  PERSONALITIES,
  type Difficulty,
  type GameRules,
  type Personality,
} from "../src/sim/rules.ts";
import { runTick, TICK_STEPS, type TickStep } from "../src/sim/tick.ts";
import { createWorld, type World } from "../src/sim/world.ts";
import { loadRules } from "./rulesFile.ts";

interface Options {
  games: number;
  bots: number;
  tribes: number;
  difficulty: Difficulty;
  firstSeed: number;
  mapSeed: number;
  width: number;
  height: number;
  maxTicks: number;
  rules: GameRules;
  personality: Personality | undefined;
  /** 0 = free-for-all. */
  teams: number;
}

export interface GameReport {
  seed: number;
  winner: string | null;
  winnerPersonality: string | null;
  /** "nation" or "tribe". */
  winnerTier: string | null;
  /** Team games: the winning team (0 = none / free-for-all). */
  winningTeam: number;
  /** Attacks launched between teammates (must stay 0). */
  teammateAttacks: number;
  reason: string;
  minutes: number;
  /** When all land was owned… */
  landRaceMinutes: number | null;
  /** …and when 90% of it was (the last stray corners can take a while). */
  land90Minutes: number | null;
  leadChanges: number;
  /**
   * Whether the leader at minute 3 went on to win (null if the game ended sooner). In team
   * games the leader is the team with the most land.
   */
  leaderAt3Won: boolean | null;
  eliminations: number;
  attacks: number;
  rejected: number;
  /** Alliance activity (GAME_DESIGN §3.14); nationAlliances = between two non-tribes. */
  diplomacy: {
    requests: number;
    declined: number;
    formed: number;
    nationAlliances: number;
    renewed: number;
    expired: number;
    betrayals: number;
  };
  /** Gold (GAME_DESIGN §3.16), totals over all players. */
  economy: {
    earned: number;
    mobilized: number;
    mobilizes: number;
    troopGifts: number;
    troopsGiven: number;
    goldGifts: number;
    goldGiven: number;
    looted: number;
    /** Median gold per second of the nations alive at minutes 1, 3, 6 (null: game over). */
    income1: number | null;
    income3: number | null;
    income6: number | null;
  };
  /** Buildings (GAME_DESIGN §3.17), totals over all players. */
  buildings: {
    builds: number;
    upgrades: number;
    goldSpent: number;
    cancelled: number;
    captured: number;
    destroyed: number;
    /** Buildings standing at the end, by level. */
    endL1: number;
    endL2: number;
    endL3: number;
    /** Minutes of play until the first building of each level was finished (null: never). */
    firstL1: number | null;
    firstL2: number | null;
    firstL3: number | null;
  };
  tickMs: { avg: number; p99: number; max: number };
  /** Per tick step: average and worst milliseconds. */
  systemsMs: Record<TickStep, { avg: number; max: number }>;
  /** The slowest tick: when it happened and what each step took. */
  worstTick: { tick: number; ms: number; steps: Partial<Record<TickStep, number>> };
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
      tribes: { type: "string", default: "0" },
      difficulty: { type: "string", default: "hard" },
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
      "no-alliances": { type: "boolean", default: false },
      teams: { type: "string", default: "0" },
      "no-economy": { type: "boolean", default: false },
      "no-buildings": { type: "boolean", default: false },
    },
  });
  const loaded = loadRules(args.rules);
  const withEconomy = args["no-economy"]
    ? { ...loaded, economy: { ...loaded.economy, enabled: false } }
    : loaded;
  const rules = args["no-buildings"]
    ? { ...withEconomy, buildings: { ...withEconomy.buildings, enabled: false } }
    : withEconomy;
  const options: Options = {
    games: Number(args.games),
    bots: Number(args.bots),
    tribes: Number(args.tribes),
    difficulty: parseDifficulty(args.difficulty!),
    firstSeed: Number(args.seed),
    mapSeed: Number(args["map-seed"]),
    width: Number(args.width),
    height: Number(args.height),
    maxTicks: Number(args["max-minutes"]) * 60 * TICKS_PER_SECOND,
    rules: args["no-alliances"]
      ? { ...rules, diplomacy: { ...rules.diplomacy, enabled: false } }
      : rules,
    personality: parsePersonality(args.personality),
    teams: Number(args.teams),
  };
  if (!Number.isInteger(options.teams) || options.teams < 0 || options.teams === 1) {
    throw new Error("--teams must be 0 (free-for-all) or at least 2");
  }
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
    players: [
      ...Array.from({ length: options.bots }, (_, k) => ({
        name: `Nation ${k + 1}`,
        kind: "bot" as const,
        personality: options.personality,
        difficulty: options.difficulty,
        team: options.teams > 0 ? (k % options.teams) + 1 : 0,
      })),
      ...Array.from({ length: options.tribes }, (_, k) => ({
        name: `Tribe ${k + 1}`,
        kind: "bot" as const,
        tier: "tribe" as const,
      })),
    ],
  });
  const times: number[] = [];
  const stepTotal = new Map<TickStep, number>(TICK_STEPS.map((step) => [step, 0]));
  const stepMax = new Map<TickStep, number>(TICK_STEPS.map((step) => [step, 0]));
  let tickSteps: Partial<Record<TickStep, number>> = {};
  let worstTick: GameReport["worstTick"] = { tick: 0, ms: 0, steps: {} };
  let stepStartedAt = 0;
  const probe = (step: TickStep): void => {
    const now = performance.now();
    const ms = now - stepStartedAt;
    stepStartedAt = now;
    tickSteps[step] = ms;
    stepTotal.set(step, stepTotal.get(step)! + ms);
    if (ms > stepMax.get(step)!) stepMax.set(step, ms);
  };
  let leader = 0;
  let leadChanges = -1;
  let leaderAt3 = 0;
  let landRaceTick: number | null = null;
  let land90Tick: number | null = null;
  let eliminations = 0;
  let attacks = 0;
  let rejected = 0;
  let teammateAttacks = 0;
  const diplomacy = {
    requests: 0,
    declined: 0,
    formed: 0,
    nationAlliances: 0,
    renewed: 0,
    expired: 0,
    betrayals: 0,
  };
  const isTribeId = (id: number) => world.players[id - 1]?.brain?.tier === "tribe";
  const economy: GameReport["economy"] = {
    earned: 0,
    mobilized: 0,
    mobilizes: 0,
    troopGifts: 0,
    troopsGiven: 0,
    goldGifts: 0,
    goldGiven: 0,
    looted: 0,
    income1: null,
    income3: null,
    income6: null,
  };
  const buildings: GameReport["buildings"] = {
    builds: 0,
    upgrades: 0,
    goldSpent: 0,
    cancelled: 0,
    captured: 0,
    destroyed: 0,
    endL1: 0,
    endL2: 0,
    endL3: 0,
    firstL1: null,
    firstL2: null,
    firstL3: null,
  };
  let reason = "timeout";
  let error: string | null = null;

  try {
    while (world.phase !== "ended" && world.tick < options.maxTicks) {
      const startedAt = performance.now();
      stepStartedAt = startedAt;
      tickSteps = {};
      const frame = runTick(world, { tick: world.tick + 1, commands: [] }, probe);
      const ms = performance.now() - startedAt;
      times.push(ms);
      if (ms > worstTick.ms) worstTick = { tick: world.tick, ms, steps: tickSteps };
      for (const event of frame.events) {
        if (event.type === "eliminated") eliminations++;
        else if (event.type === "attackStarted") {
          attacks++;
          const team = world.players[event.attacker - 1]!.team;
          if (team > 0 && world.players[event.target - 1]?.team === team) teammateAttacks++;
        } else if (event.type === "commandRejected") rejected++;
        else if (event.type === "gameOver") reason = event.reason;
        else if (event.type === "allianceRequested") diplomacy.requests++;
        else if (event.type === "allianceRequestEnded" && event.reason === "declined") {
          diplomacy.declined++;
        } else if (event.type === "allianceFormed") {
          diplomacy.formed++;
          if (!isTribeId(event.a) && !isTribeId(event.b)) diplomacy.nationAlliances++;
        } else if (event.type === "allianceRenewed") diplomacy.renewed++;
        else if (event.type === "allianceEnded" && event.reason === "expired") diplomacy.expired++;
        else if (event.type === "allianceBroken") diplomacy.betrayals++;
        else if (event.type === "mobilized") {
          economy.mobilizes++;
          economy.mobilized += event.gold;
        } else if (event.type === "donated") {
          if (event.resource === "troops") {
            economy.troopGifts++;
            economy.troopsGiven += event.amount;
          } else {
            economy.goldGifts++;
            economy.goldGiven += event.amount;
          }
        }
        if (event.type === "eliminated") economy.looted += event.loot;
        else if (event.type === "buildingStarted") {
          if (event.level === 1) buildings.builds++;
          else buildings.upgrades++;
          buildings.goldSpent += event.gold;
        } else if (event.type === "buildingCancelled") buildings.cancelled++;
        else if (event.type === "buildingCaptured") buildings.captured++;
        else if (event.type === "buildingDestroyed" && event.reason === "captured") {
          buildings.destroyed++;
        } else if (event.type === "buildingCompleted") {
          const key = (["firstL1", "firstL2", "firstL3"] as const)[event.level - 1]!;
          buildings[key] ??= round((world.tick - world.playStartTick) / 600, 2);
        }
      }
      for (const p of world.players) if (p.alive) economy.earned += p.lastIncome;
      if (world.playStartTick >= 0) {
        const played = world.tick - world.playStartTick;
        for (const [minute, key] of [
          [1, "income1"],
          [3, "income3"],
          [6, "income6"],
        ] as const) {
          if (played === minute * 60 * TICKS_PER_SECOND) {
            const incomes = world.players
              .filter((p) => p.alive && p.brain?.tier !== "tribe")
              .map((p) => p.lastIncome * TICKS_PER_SECOND);
            economy[key] = median(incomes);
          }
        }
      }
      if (world.tick % LEADER_SAMPLE_TICKS === 0) {
        const top = leadingSide(world);
        if (top !== leader) {
          leader = top;
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

  for (const b of world.buildings) {
    if (b.level === 1) buildings.endL1++;
    else if (b.level === 2) buildings.endL2++;
    else if (b.level === 3) buildings.endL3++;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const winner = world.winner !== null ? world.players[world.winner - 1]! : null;
  const playTicks = world.tick - Math.max(0, world.playStartTick);
  return {
    seed,
    winner: winner?.name ?? null,
    winnerPersonality:
      winner?.brain?.tier === "tribe" ? null : (winner?.brain?.personality ?? null),
    winnerTier: winner?.brain?.tier ?? null,
    winningTeam: world.winningTeam,
    teammateAttacks,
    reason: error ? "error" : reason,
    minutes: round(playTicks / TICKS_PER_SECOND / 60),
    landRaceMinutes:
      landRaceTick === null ? null : round((landRaceTick - world.playStartTick) / 600),
    land90Minutes: land90Tick === null ? null : round((land90Tick - world.playStartTick) / 600, 2),
    leadChanges: Math.max(0, leadChanges),
    leaderAt3Won:
      leaderAt3 === 0 ? null : leaderAt3 === (options.teams > 0 ? world.winningTeam : world.winner),
    eliminations,
    attacks,
    rejected,
    diplomacy,
    economy,
    buildings,
    tickMs: {
      avg: round(times.reduce((s, t) => s + t, 0) / Math.max(1, times.length), 3),
      p99: round(sorted[Math.floor(sorted.length * 0.99)] ?? 0, 3),
      max: round(sorted.at(-1) ?? 0, 3),
    },
    systemsMs: Object.fromEntries(
      TICK_STEPS.map((step) => [
        step,
        {
          avg: round(stepTotal.get(step)! / Math.max(1, times.length), 4),
          max: round(stepMax.get(step)!, 2),
        },
      ]),
    ) as GameReport["systemsMs"],
    worstTick: {
      tick: worstTick.tick,
      ms: round(worstTick.ms, 2),
      steps: Object.fromEntries(
        Object.entries(worstTick.steps).map(([step, ms]) => [step, round(ms, 2)]),
      ),
    },
    error,
  };
}

/** The player (free-for-all) or team (team games) holding the most land. */
function leadingSide(world: World): number {
  if (world.teamCount === 0) return world.players.reduce((a, b) => (b.tiles > a.tiles ? b : a)).id;
  const land = new Array<number>(world.teamCount + 1).fill(0);
  for (const p of world.players) land[p.team]! += p.tiles;
  let best = 1;
  for (let team = 2; team <= world.teamCount; team++) if (land[team]! > land[best]!) best = team;
  return best;
}

function describe(report: GameReport, done: number, total: number): string {
  return (
    `game ${done}/${total} seed ${report.seed}: ` +
    (report.winningTeam > 0 ? `team ${report.winningTeam} (top: ` : "") +
    `${report.winner ?? "no winner"}${report.winningTeam > 0 ? ")" : ""} ` +
    `(${report.winnerPersonality ?? "-"}) by ${report.reason} after ${report.minutes} min, ` +
    `land 90% ${report.land90Minutes ?? "-"} / all ${report.landRaceMinutes ?? "-"} min, ` +
    `${report.leadChanges} lead changes, ` +
    `${report.diplomacy.formed} alliances (${report.diplomacy.nationAlliances} between nations), ` +
    `${report.diplomacy.betrayals} betrayals, ` +
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
  const tierWins = new Map<string, number>();
  for (const r of finished) {
    tierWins.set(r.winnerTier ?? "?", (tierWins.get(r.winnerTier ?? "?") ?? 0) + 1);
    if (r.winnerTier === "tribe") continue;
    wins.set(r.winnerPersonality ?? "?", (wins.get(r.winnerPersonality ?? "?") ?? 0) + 1);
  }
  const teamWins = new Map<number, number>();
  for (const r of finished) {
    if (r.winningTeam > 0) teamWins.set(r.winningTeam, (teamWins.get(r.winningTeam) ?? 0) + 1);
  }
  const leaderKnown = reports.filter((r) => r.leaderAt3Won !== null);
  const summary = {
    games: options.games,
    nations: options.bots,
    tribes: options.tribes,
    teams: options.teams,
    difficulty: options.difficulty,
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
    winsByTier: Object.fromEntries(tierWins),
    winsByPersonality: Object.fromEntries(wins),
    ...(options.teams > 0
      ? {
          winsByTeam: Object.fromEntries([...teamWins].sort((a, b) => a[0] - b[0])),
          wonByLastTeamStanding: finished.filter((r) => r.reason === "lastStanding").length,
          teammateAttacks: reports.reduce((s, r) => s + r.teammateAttacks, 0),
        }
      : {}),
    rejectedCommands: reports.reduce((s, r) => s + r.rejected, 0),
    diplomacyPerGame: Object.fromEntries(
      (Object.keys(reports[0]?.diplomacy ?? {}) as (keyof GameReport["diplomacy"])[]).map((key) => [
        key,
        round(reports.reduce((s, r) => s + r.diplomacy[key], 0) / Math.max(1, reports.length)),
      ]),
    ),
    economyPerGame: Object.fromEntries(
      (Object.keys(reports[0]?.economy ?? {}) as (keyof GameReport["economy"])[]).map((key) =>
        key.startsWith("income")
          ? [key + "Median", median(reports.map((r) => r.economy[key]))]
          : [
              key,
              Math.round(
                reports.reduce((s, r) => s + (r.economy[key] ?? 0), 0) /
                  Math.max(1, reports.length),
              ),
            ],
      ),
    ),
    buildingsPerGame: Object.fromEntries(
      (Object.keys(reports[0]?.buildings ?? {}) as (keyof GameReport["buildings"])[]).map((key) =>
        key.startsWith("first")
          ? [
              key + "Median",
              {
                minutes: median(reports.map((r) => r.buildings[key])),
                games: reports.filter((r) => r.buildings[key] !== null).length,
              },
            ]
          : [
              key,
              round(
                reports.reduce((s, r) => s + (r.buildings[key] ?? 0), 0) /
                  Math.max(1, reports.length),
              ),
            ],
      ),
    ),
    tickMs: {
      avg: round(reports.reduce((s, r) => s + r.tickMs.avg, 0) / Math.max(1, reports.length), 3),
      worstP99: Math.max(...reports.map((r) => r.tickMs.p99)),
      worstMax: Math.max(...reports.map((r) => r.tickMs.max)),
    },
    systemsMs: Object.fromEntries(
      TICK_STEPS.map((step) => [
        step,
        {
          avg: round(
            reports.reduce((s, r) => s + r.systemsMs[step].avg, 0) / Math.max(1, reports.length),
            4,
          ),
          worstMax: Math.max(...reports.map((r) => r.systemsMs[step].max)),
        },
      ]),
    ),
    worstTicks: [...reports]
      .sort((a, b) => b.worstTick.ms - a.worstTick.ms)
      .slice(0, 3)
      .map((r) => ({ seed: r.seed, ...r.worstTick })),
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

function parseDifficulty(value: string): Difficulty {
  if (!(DIFFICULTIES as readonly string[]).includes(value)) {
    throw new Error(`unknown difficulty "${value}" (one of ${DIFFICULTIES.join(", ")})`);
  }
  return value as Difficulty;
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
