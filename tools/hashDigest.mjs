// Regression check (used in 2.9 and 2B.0): plays bots-only games with the simulation under
// <root> and prints, per game, a digest of every tick's state hash. Run it on this checkout
// and on a worktree of the previous commit/tag (git worktree add <dir> phase-2), then diff:
// identical lines = identical games.
//   node tools/hashDigest.mjs <root> <continent|tribes|islands|twinTeams> <seeds, e.g. 1,2,3> [rules]
// [rules]: optional JSON overrides for makeRules, e.g. '{"flights":{"enabled":false}}' (2B.1:
// a new system switched off must replay the previous commit's games exactly).
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [root, config, seedList, rulesJson] = process.argv.slice(2);
const load = (p) => import(pathToFileURL(join(root, p)).href);
const { createWorld } = await load("src/sim/world.ts");
const { runTick } = await load("src/sim/tick.ts");
const { generateMap } = await load("src/sim/map/generate.ts");
const { makeRules } = await load("src/sim/rules.ts");
const rules = rulesJson ? makeRules(JSON.parse(rulesJson)) : undefined;

const CONFIGS = {
  continent: { style: "continent", nations: 8, tribes: 0, teams: 0, difficulty: "hard" },
  tribes: { style: "continent", nations: 10, tribes: 60, teams: 0, difficulty: "medium" },
  islands: { style: "archipelago", nations: 8, tribes: 0, teams: 0, difficulty: "hard" },
  twinTeams: { style: "twin", nations: 8, tribes: 10, teams: 2, difficulty: "hard" },
};
const c = CONFIGS[config];
const map = generateMap({ seed: 2, width: 1100, height: 700, style: c.style });
const MAX_TICKS = 15_000;

for (const seed of seedList.split(",").map(Number)) {
  const world = createWorld({
    seed,
    ...(rules ? { rules } : {}),
    map,
    players: [
      ...Array.from({ length: c.nations }, (_, k) => ({
        name: `Nation ${k + 1}`,
        kind: "bot",
        difficulty: c.difficulty,
        team: c.teams > 0 ? (k % c.teams) + 1 : 0,
      })),
      ...Array.from({ length: c.tribes }, (_, k) => ({
        name: `Tribe ${k + 1}`,
        kind: "bot",
        tier: "tribe",
      })),
    ],
  });
  let digest = 0;
  let frame;
  while (world.phase !== "ended" && world.tick < MAX_TICKS) {
    frame = runTick(world, { tick: world.tick + 1, commands: [] });
    digest = (Math.imul(digest ^ frame.hash, 0x9e3779b1) + world.tick) >>> 0;
  }
  console.log(
    JSON.stringify({
      config,
      seed,
      ticks: world.tick,
      winner: world.winner,
      hash: frame.hash,
      digest,
    }),
  );
}
