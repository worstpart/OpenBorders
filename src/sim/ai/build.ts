/**
 * How nations build (GAME_DESIGN.md §3.17): with the same `build` / `upgrade` commands and
 * prices as a player. Tribes never build.
 *
 * A nation weighs every option — a new Housing or Factory (while it has room: one
 * building per `tilesPerBuilding` tiles) and the next level of each building it owns — by
 * **value per gold**, and picks as its goal the best one it can reach within
 * `goalHorizonTicks` of income:
 *  - capacity counts one per troop;
 *  - a growth bonus counts as that share of its peak growth for `growthHorizonTicks`;
 *  - gold per tick counts for `incomeHorizonTicks`, and a Mobilize discount as that share
 *    of the gold it earns over the same time.
 * Escalating prices make the next new building dearer, so upgrades win in time. Gold is
 * also its war chest (§3.16, Mobilize right before attacking a player); while saving, it
 * keeps part of the goal's price out of the chest (`saving`, by personality), and builds
 * once it can pay — in peacetime, one construction at a time, never while losing a war at
 * home. New buildings go deep inside
 * its land (sampled tiles, scored by how far they are from the nearest tile it doesn't
 * own), where they are hardest to capture.
 */
import type { Command } from "../commands.ts";
import { isLand, tileAt, type GameMap } from "../map/gameMap.ts";
import { detPow } from "../math/detmath.ts";
import {
  BUILDING_TYPES,
  type BuildingLevelRules,
  type BuildingType,
  type Personality,
} from "../rules.ts";
import {
  buildingPrice,
  buildingsEnabled,
  levelRules,
  levelsOwned,
  MAX_LEVEL,
  placementProblem,
} from "../systems/buildings.ts";
import type { Building, Player, World } from "../world.ts";

/** Max distance (tiles) the depth score looks for the edge of the bot's land. */
const DEPTH_REACH = 24;
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** The building option a nation aims for: the best value per gold it can reach soon. */
interface Goal {
  readonly price: number;
  /** An upgrade, or a new building (its site is chosen when it is actually built). */
  readonly upgrade: number | null;
  readonly newType: BuildingType | null;
}

function buildingGoal(world: World, bot: Player): Goal | null {
  const rules = world.rules;
  if (!buildingsEnabled(rules) || world.phase !== "playing" || bot.lastIncome <= 0) return null;
  const ai = rules.ai.build;
  const reach = bot.lastIncome * ai.goalHorizonTicks;
  const mine: Building[] = [];
  for (const b of world.buildings) if (b.owner === bot.id) mine.push(b);
  if (mine.some((b) => b.readyTick >= 0)) return null; // one construction at a time

  let goal: Goal | null = null;
  let bestScore = 0;
  const consider = (
    price: number,
    value: number,
    upgrade: number | null,
    newType: BuildingType | null,
  ) => {
    const score = value / price;
    if (price <= reach && score > bestScore) {
      goal = { price, upgrade, newType };
      bestScore = score;
    }
  };
  for (const b of mine) {
    if (b.level >= MAX_LEVEL) continue;
    const level = b.level + 1;
    const price = buildingPrice(rules, b.type, level, levelsOwned(world.buildings, bot.id, b.type));
    const value =
      worth(world, bot, levelRules(rules, b.type, level)) -
      worth(world, bot, levelRules(rules, b.type, b.level));
    consider(price, value, b.id, null);
  }
  if (mine.length < Math.floor(bot.tiles / ai.tilesPerBuilding)) {
    for (const type of BUILDING_TYPES) {
      const price = buildingPrice(rules, type, 1, levelsOwned(world.buildings, bot.id, type));
      consider(price, worth(world, bot, levelRules(rules, type, 1)), null, type);
    }
  }
  return goal;
}

/** A nation's building decision for this think, or null: its goal, once it can pay for it. */
export function decideBuild(world: World, bot: Player, incoming: number): Command | null {
  if (incoming > bot.homeTroops * 0.5) return null; // losing a war at home: no investments
  const goal = buildingGoal(world, bot);
  if (!goal || bot.gold < goal.price) return null;
  if (goal.upgrade !== null) return { type: "upgrade", buildingId: goal.upgrade };
  const tile = buildSite(world, bot);
  return tile < 0 ? null : { type: "build", buildingType: goal.newType!, tile };
}

/** Gold a nation keeps out of its war chest while saving for its goal. */
export function buildingReserve(world: World, bot: Player, personality: Personality): number {
  const goal = buildingGoal(world, bot);
  if (!goal) return 0;
  return Math.min(bot.gold, goal.price * world.rules.ai.build.saving[personality]);
}

/** What a level's effects are worth to this bot, in troop-equivalents. */
function worth(world: World, bot: Player, effect: BuildingLevelRules): number {
  const ai = world.rules.ai.build;
  const troops = world.rules.troops;
  const peakGrowth = troops.growthScale * detPow(Math.max(1, bot.capacity), troops.growthExponent);
  const income = bot.lastIncome * ai.incomeHorizonTicks;
  return (
    (effect.capacity ?? 0) +
    (effect.growthBonus ?? 0) * peakGrowth * ai.growthHorizonTicks +
    (effect.income ?? 0) * ai.incomeHorizonTicks +
    (effect.mobilizeDiscount ?? 0) * income
  );
}

/**
 * A tile deep inside the bot's land where a building may stand, or -1. Candidates are
 * sampled around the middle of its border (roughly the middle of its land) and around its
 * spawn; the deepest valid one wins.
 */
function buildSite(world: World, bot: Player): number {
  const { map } = world;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const tile of bot.border) {
    sumX += tile % map.width;
    sumY += Math.floor(tile / map.width);
    count++;
  }
  if (count === 0) return -1;
  const centers = [[Math.round(sumX / count), Math.round(sumY / count)]];
  if (bot.spawnTile >= 0 && world.owner[bot.spawnTile] === bot.id) {
    centers.push([bot.spawnTile % map.width, Math.floor(bot.spawnTile / map.width)]);
  }
  const radius = Math.max(4, Math.floor(Math.sqrt(bot.tiles / 3.14)));
  const samples = world.rules.ai.build.placementSamples;
  let best = -1;
  let bestDepth = 2; // at least 3 tiles from the edge of its land
  for (let k = 0; k < samples; k++) {
    const [cx, cy] = centers[k % centers.length]!;
    const x = cx! + world.rng.nextIntBetween(-radius, radius);
    const y = cy! + world.rng.nextIntBetween(-radius, radius);
    if (!inBounds(map, x, y)) continue;
    const tile = tileAt(map, x, y);
    if (world.owner[tile] !== bot.id || !isLand(map, tile)) continue;
    if (placementProblem(world.rules, map, world.owner, world.buildings, bot.id, tile)) continue;
    const depth = depthOf(world, bot, x, y);
    if (depth > bestDepth) {
      best = tile;
      bestDepth = depth;
    }
  }
  return best;
}

/** Steps (up to DEPTH_REACH) from (x, y) to the nearest tile the bot doesn't own, on 8 rays. */
function depthOf(world: World, bot: Player, x: number, y: number): number {
  const { map } = world;
  let depth = DEPTH_REACH;
  for (const [dx, dy] of DIRECTIONS) {
    for (let step = 1; step < depth; step++) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      if (!inBounds(map, nx, ny) || world.owner[tileAt(map, nx, ny)] !== bot.id) {
        depth = step;
        break;
      }
    }
  }
  return depth;
}

function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}
