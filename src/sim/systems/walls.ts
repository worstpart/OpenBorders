/**
 * Walls — Border Defense (GAME_DESIGN.md §3.17.6, D-024).
 *
 * A player draws a wall on their own land by clicking corner points A, B, C …; each piece
 * is a straight 8-connected line of tiles between two points (no diagonal leaks: fronts
 * spread to the four neighbours of a tile, so they can't slip between two diagonal wall
 * tiles). A wall is paid per tile, built in one go and upgraded as a whole (levels I–III).
 *
 * A finished wall tile is hard to take: the attack waits there (`holdTicks`, shortened for
 * a crushing army but never below half) and pays `loss`× the troops plus `breakTroops`.
 * Fronts therefore flow around the ends and through gaps, and a closed wall forces a
 * break-through. A wall tile that changes hands — taken, encircled, absorbed — **breaks**:
 * a gap opens and the rest stands. A wall with no tiles left is gone.
 *
 * Walls are game state (hashed via world.wallHash). `world.fortLevel` is the working level
 * of the wall on each tile (0 = none, or still being built) — what the attack code, the
 * HUD and the renderer read; its changes are logged for the frame.
 */
import { isLand, isValidTile, type GameMap } from "../map/gameMap.ts";
import type { GameRules, WallLevelRules } from "../rules.ts";
import { ownerTileHash } from "../stateHash.ts";
import type { Player, PlayerId, Wall, World } from "../world.ts";
import { isSuppressed } from "./suppression.ts";

/** A wall holds even a crushing army at least this share of its hold time. */
const MIN_HOLD_SHARE = 0.5;

/** The rules of wall level 1..3. */
export function wallLevel(rules: GameRules, level: number): WallLevelRules {
  const found = rules.walls.levels[level - 1];
  if (!found) throw new RangeError(`walls have no level ${level}`);
  return found;
}

/**
 * The tiles of a wall through `points`, in order, without repeats: straight 8-connected
 * lines (Bresenham) from each point to the next. Shared with the HUD's preview.
 */
export function wallTiles(map: GameMap, points: readonly number[]): number[] {
  const tiles: number[] = [];
  const seen = new Set<number>();
  const add = (tile: number) => {
    if (!seen.has(tile)) {
      seen.add(tile);
      tiles.push(tile);
    }
  };
  if (points.length === 1) add(points[0]!);
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!;
    const b = points[k]!;
    let x = a % map.width;
    let y = Math.floor(a / map.width);
    const x1 = b % map.width;
    const y1 = Math.floor(b / map.width);
    const dx = Math.abs(x1 - x);
    const dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1;
    const sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      add(y * map.width + x);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  return tiles;
}

/** Wall tile-levels a player owns (built, being built or upgraded): what escalation counts. */
export function wallLevelsOwned(
  walls: readonly { owner: PlayerId; targetLevel: number; intact: number }[],
  owner: PlayerId,
): number {
  let total = 0;
  for (const w of walls) if (w.owner === owner) total += w.intact * w.targetLevel;
  return total;
}

/** Gold to build `tiles` wall tiles at level 1, or to upgrade that many to `level`. */
export function wallPrice(rules: GameRules, level: number, tiles: number, owned: number): number {
  const b = rules.buildings;
  const factor = Math.min(
    b.escalationMax,
    1 + (b.escalationPerLevel * owned) / rules.walls.escalationTiles,
  );
  const raw = wallLevel(rules, level).costPerTile * tiles * factor;
  return Math.max(b.priceRounding, Math.round(raw / b.priceRounding) * b.priceRounding);
}

/** Ticks to build (level 1) or upgrade to `level` a wall of `tiles` tiles. */
export function wallBuildTicks(rules: GameRules, level: number, tiles: number): number {
  const l = wallLevel(rules, level);
  return l.buildTicks + l.buildTicksPerTile * tiles;
}

export type WallProblem =
  | "tooFewPoints"
  | "tooManyPoints"
  | "tooLong"
  | "notYourLand"
  | "water"
  | "building"
  | "nothingNew";

export const WALL_PROBLEM_TEXT: Record<WallProblem, string> = {
  tooFewPoints: "a wall needs at least two points",
  tooManyPoints: "too many points",
  tooLong: "too long",
  notYourLand: "walls go on your own land",
  water: "walls can't cross water",
  building: "a building is in the way",
  nothingNew: "there is already a wall there",
};

/**
 * Why a wall can't go through `points` (gold aside), or null — and the tiles it would
 * add (tiles already walled are joined, not built again). Shared with the HUD.
 */
export function wallPlan(
  rules: GameRules,
  map: GameMap,
  owner: ArrayLike<number>,
  isBuilding: (tile: number) => boolean,
  isWalled: (tile: number) => boolean,
  playerId: PlayerId,
  points: readonly number[],
): { problem: WallProblem | null; tiles: number[] } {
  if (points.length < 2) return { problem: "tooFewPoints", tiles: [] };
  if (points.length > rules.walls.maxPoints) return { problem: "tooManyPoints", tiles: [] };
  for (const p of points) {
    if (!Number.isInteger(p) || !isValidTile(map, p)) return { problem: "notYourLand", tiles: [] };
  }
  const tiles = wallTiles(map, points).filter((t) => !isWalled(t));
  if (tiles.length > rules.walls.maxTiles) return { problem: "tooLong", tiles };
  for (const t of tiles) {
    if (!isLand(map, t)) return { problem: "water", tiles };
    if (owner[t] !== playerId) return { problem: "notYourLand", tiles };
    if (isBuilding(t)) return { problem: "building", tiles };
  }
  if (tiles.length === 0) return { problem: "nothingNew", tiles };
  return { problem: null, tiles };
}

/** Handles `buildWall`. Returns a rejection reason, or null on success. */
export function applyBuildWall(
  world: World,
  player: Player,
  points: readonly number[],
): string | null {
  const rules = world.rules;
  if (!rules.buildings.enabled || !rules.economy.enabled) return "there are no walls in this game";
  if (world.phase !== "playing") return "the match hasn't started";
  if (!Array.isArray(points)) return "no points";
  const plan = wallPlan(
    rules,
    world.map,
    world.owner,
    (t) => world.buildingAt[t]! >= 0,
    (t) => world.wallAt[t]! >= 0,
    player.id,
    points,
  );
  if (plan.problem) return WALL_PROBLEM_TEXT[plan.problem];
  const price = wallPrice(rules, 1, plan.tiles.length, wallLevelsOwned(world.walls, player.id));
  if (player.gold < price) return "not enough gold";

  player.gold -= price;
  const wall: Wall = {
    id: world.nextWallId++,
    owner: player.id,
    points: points.slice(),
    tiles: plan.tiles,
    intact: plan.tiles.length,
    level: 0,
    targetLevel: 1,
    startTick: world.tick,
    readyTick: world.tick + wallBuildTicks(rules, 1, plan.tiles.length),
    paid: price,
  };
  world.walls.push(wall);
  for (const t of wall.tiles) {
    world.wallAt[t] = wall.id;
    world.wallHash = (world.wallHash ^ ownerTileHash(t, wall.id)) >>> 0;
  }
  world.wallsVersion++;
  world.events.push({
    type: "wallStarted",
    wallId: wall.id,
    playerId: player.id,
    level: 1,
    tiles: wall.intact,
    gold: price,
  });
  return null;
}

/** Handles `upgradeWall`: the whole wall (what still stands) goes up one level. */
export function applyUpgradeWall(world: World, player: Player, wallId: number): string | null {
  const rules = world.rules;
  if (world.phase !== "playing") return "the match hasn't started";
  const wall = findWall(world, wallId);
  if (!wall || wall.owner !== player.id) return "not your wall";
  if (wall.readyTick >= 0) return "it is still being built";
  if (wall.level >= rules.walls.levels.length) return "already at the top level";
  const level = wall.level + 1;
  const price = wallPrice(rules, level, wall.intact, wallLevelsOwned(world.walls, player.id));
  if (player.gold < price) return "not enough gold";
  player.gold -= price;
  wall.targetLevel = level;
  wall.startTick = world.tick;
  wall.readyTick = world.tick + wallBuildTicks(rules, level, wall.intact);
  wall.paid = price;
  world.wallsVersion++;
  world.events.push({
    type: "wallStarted",
    wallId,
    playerId: player.id,
    level,
    tiles: wall.intact,
    gold: price,
  });
  return null;
}

/** Handles `cancelWall`: stops a construction (the wall goes) or an upgrade (it stays). */
export function applyCancelWall(world: World, player: Player, wallId: number): string | null {
  const wall = findWall(world, wallId);
  if (!wall || wall.owner !== player.id) return "not your wall";
  if (wall.readyTick < 0) return "nothing is being built there";
  const refund = Math.floor(wall.paid * world.rules.buildings.cancelRefund);
  player.gold += refund;
  world.events.push({ type: "wallCancelled", wallId, playerId: player.id, refund });
  if (wall.level === 0) {
    for (const t of wall.tiles) if (world.wallAt[t] === wall.id) releaseTile(world, wall, t);
    removeWall(world, wall, null, "cancelled");
  } else {
    wall.targetLevel = wall.level;
    idle(wall);
    world.wallsVersion++;
  }
  return null;
}

/** Tick system (with the buildings, step 5b): constructions and upgrades finish. */
export function updateWalls(world: World): void {
  for (const wall of world.walls) {
    if (wall.readyTick >= 0 && world.tick >= wall.readyTick) {
      wall.level = wall.targetLevel;
      idle(wall);
      for (const t of wall.tiles) if (world.wallAt[t] === wall.id) setFort(world, t, wall.level);
      world.wallsVersion++;
      world.events.push({
        type: "wallCompleted",
        wallId: wall.id,
        playerId: wall.owner,
        level: wall.level,
      });
    }
  }
}

/** Called by setOwner when a wall tile changes hands: that piece of the wall breaks. */
export function breakWallTile(world: World, tile: number, by: PlayerId): void {
  const wall = findWall(world, world.wallAt[tile]!);
  if (!wall) return;
  releaseTile(world, wall, tile);
  world.events.push({ type: "wallBreached", wallId: wall.id, playerId: wall.owner, tile, by });
  if (wall.intact === 0) removeWall(world, wall, by === 0 ? null : by, "breached");
}

/**
 * The wall level that works on `tile` now: 0 with no wall, or while an air strike suppresses
 * it (2B.4) — the hooks below all read it.
 */
function workingFort(world: World, tile: number): number {
  const level = world.fortLevel[tile]!;
  return level === 0 || isSuppressed(world, tile) ? 0 : level;
}

/** Multiplier on an attacker's losses for taking `tile` (1 = no wall). */
export function wallLossFactor(world: World, tile: number): number {
  const level = workingFort(world, tile);
  return level === 0 ? 1 : wallLevel(world.rules, level).loss;
}

/** Troops an attack pays on top of the tile's cost to break the wall on it (0 = none). */
export function wallBreakTroops(world: World, tile: number): number {
  const level = workingFort(world, tile);
  return level === 0 ? 0 : wallLevel(world.rules, level).breakTroops;
}

/**
 * Extra ticks before `tile` falls (0 = no wall). `speed` is the attack's delay factor
 * (1 at even odds, smaller for a bigger army): a bigger army breaks walls faster (by the
 * square root of its speed-up), but a wall always holds at least MIN_HOLD_SHARE of its time.
 */
export function wallHoldTicks(world: World, tile: number, speed: number): number {
  const level = workingFort(world, tile);
  if (level === 0) return 0;
  return wallLevel(world.rules, level).holdTicks * Math.max(MIN_HOLD_SHARE, Math.sqrt(speed));
}

export function findWall(world: World, id: number): Wall | undefined {
  if (!Number.isInteger(id) || id < 0) return undefined;
  // Ids ascend, so a binary search finds it.
  const list = world.walls;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = list[mid]!;
    if (w.id === id) return w;
    if (w.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

function idle(wall: Wall): void {
  wall.startTick = -1;
  wall.readyTick = -1;
  wall.paid = 0;
}

function releaseTile(world: World, wall: Wall, tile: number): void {
  world.wallAt[tile] = -1;
  world.wallHash = (world.wallHash ^ ownerTileHash(tile, wall.id)) >>> 0;
  wall.intact--;
  setFort(world, tile, 0);
  world.wallsVersion++;
}

function removeWall(
  world: World,
  wall: Wall,
  by: PlayerId | null,
  reason: "breached" | "cancelled",
): void {
  world.walls = world.walls.filter((w) => w !== wall);
  world.wallsVersion++;
  world.events.push({ type: "wallDestroyed", wallId: wall.id, playerId: wall.owner, by, reason });
}

function setFort(world: World, tile: number, level: number): void {
  if (world.fortLevel[tile] === level) return;
  world.fortLevel[tile] = level;
  world.fortChanges.push(tile);
}
