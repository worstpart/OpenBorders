/**
 * The spawn phase (GAME_DESIGN.md §3.3).
 *
 * - Bots are placed automatically at the start, at random spots kept apart from
 *   everyone else.
 * - Humans pick a tile with the `spawn` command (re-picking moves them) and lock it in
 *   with `confirmSpawn`. The match starts when every human has confirmed; anyone
 *   still without a spawn then gets a random one.
 * - A spawn claims the neutral land within `rules.spawn.radius` that is connected to the
 *   chosen tile (so a disc never jumps across water).
 */
import { distanceSquared, isLand, isValidTile, tileAt, tileX, tileY } from "../map/gameMap.ts";
import { NEUTRAL, setOwner, type Player, type World } from "../world.ts";
import { capacityOf, startingTroops } from "./troops.ts";

/** Handles the `spawn` command. Returns a rejection reason, or null on success. */
export function applySpawnCommand(world: World, player: Player, tile: number): string | null {
  if (world.phase !== "spawn") return "the spawn phase is over";
  if (player.ready) return "spawn already confirmed";
  if (!isValidTile(world.map, tile)) return "not a tile on this map";
  if (!isLand(world.map, tile)) return "can't start on water";
  const owner = world.owner[tile];
  if (owner !== NEUTRAL && owner !== player.id) return "another player is already there";

  releaseSpawn(world, player);
  claimSpawn(world, player, tile, false);
  return null;
}

/** Handles the `confirmSpawn` command. */
export function applyConfirmSpawn(world: World, player: Player): string | null {
  if (world.phase !== "spawn") return "the spawn phase is over";
  if (player.spawnTile < 0) return "choose a starting position first";
  player.ready = true;
  return null;
}

/**
 * Tick system for the spawn phase: places bots that haven't spawned yet, and starts
 * the match once every human has confirmed (immediately if there are no humans).
 */
export function updateSpawnPhase(world: World): void {
  for (const player of world.players) {
    if (player.kind === "bot" && player.spawnTile < 0 && player.alive) spawnRandomly(world, player);
  }
  const waitingForHumans = world.players.some((p) => p.kind === "human" && p.alive && !p.ready);
  if (waitingForHumans) return;

  for (const player of world.players) {
    if (player.spawnTile < 0 && player.alive) spawnRandomly(world, player);
  }
  world.phase = "playing";
  world.playStartTick = world.tick;
  world.events.push({ type: "phaseChanged", phase: "playing" });
}

/** True while players may not attack each other (start-of-match protection). */
export function isSpawnProtected(world: World): boolean {
  return (
    world.phase !== "playing" ||
    world.tick < world.playStartTick + world.rules.spawn.protectionTicks
  );
}

function spawnRandomly(world: World, player: Player): void {
  const tile = findRandomSpawnTile(world);
  if (tile < 0) {
    // No neutral land left anywhere: the player can't enter the game.
    player.alive = false;
    return;
  }
  claimSpawn(world, player, tile, true);
}

function claimSpawn(world: World, player: Player, center: number, automatic: boolean): void {
  for (const tile of spawnDisc(world, center)) setOwner(world, tile, player.id);
  player.spawnTile = center;
  player.capacity = capacityOf(world.rules, player);
  player.homeTroops = startingTroops(world.rules, player.tiles, player.capacity);
  world.events.push({ type: "spawned", playerId: player.id, tile: center, automatic });
}

/** Undoes a previous spawn (re-picking during the spawn phase). */
function releaseSpawn(world: World, player: Player): void {
  if (player.spawnTile < 0) return;
  const { map } = world;
  const radius = world.rules.spawn.radius;
  const cx = tileX(map, player.spawnTile);
  const cy = tileY(map, player.spawnTile);
  for (let y = Math.max(0, cy - radius); y <= Math.min(map.height - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(map.width - 1, cx + radius); x++) {
      const tile = tileAt(map, x, y);
      if (world.owner[tile] === player.id) setOwner(world, tile, NEUTRAL);
    }
  }
  player.spawnTile = -1;
  player.homeTroops = 0;
  player.capacity = 0;
}

/**
 * The tiles a spawn at `center` would claim: neutral land within the spawn radius,
 * 4-connected to the center through such tiles. Ordered by discovery (deterministic).
 */
export function spawnDisc(world: World, center: number): number[] {
  const { map } = world;
  const radiusSquared = world.rules.spawn.radius * world.rules.spawn.radius;
  const claimable = (tile: number): boolean =>
    isLand(map, tile) &&
    world.owner[tile] === NEUTRAL &&
    distanceSquared(map, tile, center) <= radiusSquared;
  if (!claimable(center)) return [];

  const result = [center];
  const seen = new Set(result);
  for (let head = 0; head < result.length; head++) {
    const tile = result[head]!;
    const x = tileX(map, tile);
    const y = tileY(map, tile);
    const candidates = [
      y > 0 ? tile - map.width : -1,
      x < map.width - 1 ? tile + 1 : -1,
      y < map.height - 1 ? tile + map.width : -1,
      x > 0 ? tile - 1 : -1,
    ];
    for (const next of candidates) {
      if (next >= 0 && !seen.has(next) && claimable(next)) {
        seen.add(next);
        result.push(next);
      }
    }
  }
  return result;
}

/** Number of tiles in a full spawn disc of the configured radius. */
function fullDiscSize(radius: number): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) count++;
  }
  return count;
}

/**
 * Picks a random spawn tile: neutral land whose disc is mostly claimable, as far as
 * possible from other spawns. The distance requirement starts from the spacing the
 * lobby size allows and is relaxed step by step when no spot is found. Returns -1 if no neutral land is left.
 */
function findRandomSpawnTile(world: World): number {
  const { map, rng, rules } = world;
  const tileCount = map.width * map.height;
  const others = world.players.filter((p) => p.spawnTile >= 0).map((p) => p.spawnTile);
  const minClaimable = Math.ceil(rules.spawn.randomMinLandShare * fullDiscSize(rules.spawn.radius));
  const ATTEMPTS_PER_ROUND = 400;

  const evenSpacing = Math.sqrt(map.landTiles / Math.max(1, world.players.length));
  let minDistance = Math.min(
    rules.spawn.randomMinDistance,
    Math.floor(rules.spawn.randomSpacingShare * evenSpacing),
  );
  for (let round = 0; round < 8; round++) {
    const minDistanceSquared = minDistance * minDistance;
    for (let attempt = 0; attempt < ATTEMPTS_PER_ROUND; attempt++) {
      const tile = rng.nextInt(tileCount);
      if (!isLand(map, tile) || world.owner[tile] !== NEUTRAL) continue;
      if (others.some((other) => distanceSquared(map, tile, other) < minDistanceSquared)) continue;
      if (spawnDisc(world, tile).length < minClaimable) continue;
      return tile;
    }
    minDistance = Math.floor(minDistance * 0.7);
  }

  // Last resort: the first neutral land tile after a random starting point.
  const start = rng.nextInt(tileCount);
  for (let k = 0; k < tileCount; k++) {
    const tile = (start + k) % tileCount;
    if (isLand(map, tile) && world.owner[tile] === NEUTRAL) return tile;
  }
  return -1;
}
