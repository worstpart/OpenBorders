// Cross-engine determinism check, Node side (milestone 3.0). Prints one JSON line per game;
// the browser side prints the same lines from the same module (tools/determinismGames.ts):
//   node tools/crossEngine.ts [ticks=3000] [seeds=1,2] [configs=islands,continent,twinTeams]
// In the browser (dev server running, any page of it open):
//   const m = await import("/tools/determinismGames.ts");
//   JSON.stringify(m.playDeterminismGame("islands", 1, 3000));
// Equal lines = both engines played the same games and made the same snapshots.
import { CONFIGS, playDeterminismGame } from "./determinismGames.ts";

const [ticksArg, seedsArg, configsArg] = process.argv.slice(2);
const ticks = Number(ticksArg ?? 3000);
const seeds = (seedsArg ?? "1,2").split(",").map(Number);
const configs = configsArg ? configsArg.split(",") : CONFIGS.map((c) => c.name);

for (const config of configs) {
  for (const seed of seeds) {
    const start = performance.now();
    const result = playDeterminismGame(config, seed, ticks);
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    console.log(JSON.stringify(result), `// ${seconds} s`);
  }
}
