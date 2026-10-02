/**
 * Front speeds (milestone 1.7): how fast land is taken on each terrain and at each troop
 * advantage, measured with the real simulation on small single-terrain maps.
 *
 *   node tools/speeds.ts [--rules overrides.json]
 *
 * Every map is a strip: the attacker holds the left 3 columns, so the front is a straight
 * line and "speed" is how many columns it advances per second (averaged over the strip;
 * the click point in the middle of the right edge advances a bit faster). No growth, so
 * only the attack itself is measured.
 */
import { parseArgs } from "node:util";
import { createMap, Terrain } from "../src/sim/map/gameMap.ts";
import { makeRules, type GameRules } from "../src/sim/rules.ts";
import { runTick } from "../src/sim/tick.ts";
import { createWorld, NEUTRAL, setOwner, type World } from "../src/sim/world.ts";
import { loadRules } from "./rulesFile.ts";

const WIDTH = 400;
const HEIGHT = 41;
const START_COLUMNS = 3;
const TICKS_PER_SECOND = 10;
const TERRAINS = [
  ["plains", Terrain.Plains],
  ["highland", Terrain.Highland],
  ["mountain", Terrain.Mountain],
] as const;

const { values: args } = parseArgs({ options: { rules: { type: "string" } } });
const base = loadRules(args.rules);
const rules = makeRules({
  ...base,
  troops: { ...base.troops, growthFloor: 0, growthScale: 0 },
  victory: { ...base.victory, landShare: 2 },
  encirclement: { ...base.encirclement, intervalTicks: 1_000_000 },
});

console.log("Expansion into neutral land (columns per second, full-speed army)");
for (const [name, terrain] of TERRAINS) {
  const world = strip(rules, terrain, false);
  const result = measure(world, NEUTRAL, 1_000_000, 10);
  console.log(`  ${name.padEnd(9)} ${result.speed.toFixed(1)} tiles/s`);
}

console.log("\nAttacks on a player (defender: 30,000 troops at home, ~2 per tile)");
console.log("  army ÷ defender   plains tiles/s   highland   mountain   troops lost per tile");
for (const advantage of [0.8, 1, 1.5, 2, 4, 10, 30]) {
  const cells: string[] = [];
  let loss = 0;
  for (const [name, terrain] of TERRAINS) {
    const world = strip(rules, terrain, true);
    const result = measure(world, 2, advantage * 30_000, 5);
    cells.push(result.speed.toFixed(1).padStart(name === "plains" ? 14 : 10));
    if (name === "plains") loss = result.lossPerTile;
  }
  console.log(
    `  ${`${advantage}×`.padEnd(15)} ${cells.join(" ")}   ${loss.toFixed(1).padStart(10)}`,
  );
}

/** A strip of one terrain; the attacker (1) holds the left columns, the rest is neutral or player 2. */
function strip(rules: GameRules, terrain: Terrain, defended: boolean): World {
  const map = createMap(WIDTH, HEIGHT, new Uint8Array(WIDTH * HEIGHT).fill(terrain));
  const world = createWorld({
    seed: 1,
    map,
    rules,
    players: [
      { name: "A", kind: "human" },
      { name: "D", kind: "human" },
    ],
  });
  for (let tile = 0; tile < WIDTH * HEIGHT; tile++) {
    const x = tile % WIDTH;
    if (x < START_COLUMNS) setOwner(world, tile, 1);
    else if (defended || tile === WIDTH * HEIGHT - 1) setOwner(world, tile, 2); // (alive: no "last standing")
  }
  for (const player of world.players) {
    player.ready = true;
    player.spawnTile = player.id === 1 ? 0 : WIDTH - 1;
    player.capacity = 10_000_000;
  }
  world.players[1]!.homeTroops = defended ? 30_000 : 0;
  world.phase = "playing";
  world.playStartTick = world.tick - rules.spawn.protectionTicks;
  return world;
}

/** Sends `army` at `target` (aimed at the middle of the far edge) for `seconds`. */
function measure(
  world: World,
  target: number,
  army: number,
  seconds: number,
): { speed: number; lossPerTile: number } {
  const attacker = world.players[0]!;
  attacker.homeTroops = army;
  const focusTile = Math.floor(HEIGHT / 2) * WIDTH + WIDTH - 1;
  const startTiles = attacker.tiles;
  runTick(world, {
    tick: world.tick + 1,
    commands: [{ playerId: 1, command: { type: "attack", target, focusTile, percentBp: 10_000 } }],
  });
  const startTick = world.tick;
  while (world.tick - startTick < seconds * TICKS_PER_SECOND && world.attacks.length > 0) {
    runTick(world, { tick: world.tick + 1, commands: [] });
  }
  const elapsed = (world.tick - startTick) / TICKS_PER_SECOND;
  const taken = attacker.tiles - startTiles;
  const spent = army - attacker.fieldTroops - attacker.homeTroops;
  return { speed: taken / HEIGHT / elapsed, lossPerTile: taken > 0 ? spent / taken : 0 };
}
