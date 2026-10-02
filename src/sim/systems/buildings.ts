/**
 * Buildings (GAME_DESIGN.md §3.17, ARCHITECTURE.md §5.7).
 *
 *  - `build` places a level-I building on your own land (gold up front, a short
 *    construction); `upgrade` raises it to the next level (the current level keeps working
 *    meanwhile); `cancelBuild` stops either and refunds part of the price.
 *  - Prices grow with the levels of that type you already own (escalation).
 *  - The level is the building's health (strikes and missiles will cost levels, Phase 2B).
 *    When its tile is captured, the taker adopts it at its level (user, 2.5 playtest) — or
 *    it is destroyed, depending on the type and on who took it (tribes never keep
 *    buildings). An unfinished building is lost; an upgrade in progress is cancelled.
 *  - Every tick the finished buildings' effects are summed into each player's `bonus`,
 *    which the troop and gold systems read; they never look at building types.
 *
 * Every change to a building goes through this file, so world.buildings, world.buildingAt,
 * the events and the bonuses stay in step. With rules.buildings.enabled = false (or no
 * economy) nothing here runs and games play as in 2.4.
 */
import { withinRange } from "../geometry.ts";
import { isLand, type GameMap } from "../map/gameMap.ts";
import {
  BUILDING_TYPES,
  type BuildingLevelRules,
  type BuildingType,
  type GameRules,
} from "../rules.ts";
import {
  getPlayer,
  isTribe,
  NEUTRAL,
  type Building,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";

/** Buildings exist in this game (they are paid in gold, so they need the economy). */
export function buildingsEnabled(rules: GameRules): boolean {
  return rules.buildings.enabled && rules.economy.enabled;
}

export function isBuildingType(value: unknown): value is BuildingType {
  return (BUILDING_TYPES as readonly unknown[]).includes(value);
}

/** The rules of one level (1..3) of a building type. */
export function levelRules(
  rules: GameRules,
  type: BuildingType,
  level: number,
): BuildingLevelRules {
  const found = rules.buildings.types[type].levels[level - 1];
  if (!found) throw new RangeError(`${type} has no level ${level}`);
  return found;
}

export const MAX_LEVEL = 3;

/** What the price escalation counts: the levels of `type` a player owns, building ones included. */
export function levelsOwned(
  buildings: readonly { owner: PlayerId; type: BuildingType; targetLevel: number }[],
  owner: PlayerId,
  type: BuildingType,
): number {
  let total = 0;
  for (const b of buildings) if (b.owner === owner && b.type === type) total += b.targetLevel;
  return total;
}

/** Gold to build (level 1) or upgrade to `level`, for a player already owning `owned` levels. */
export function buildingPrice(
  rules: GameRules,
  type: BuildingType,
  level: number,
  owned: number,
): number {
  const b = rules.buildings;
  const factor = Math.min(b.escalationMax, 1 + b.escalationPerLevel * owned);
  return (
    Math.round((levelRules(rules, type, level).cost * factor) / b.priceRounding) * b.priceRounding
  );
}

/** Why a building can't go on `tile` (gold aside), or null. Shared with the HUD. */
export type PlacementProblem = "notYourLand" | "water" | "tooClose";

export function placementProblem(
  rules: GameRules,
  map: GameMap,
  owner: ArrayLike<number>,
  buildings: readonly { tile: number }[],
  playerId: PlayerId,
  tile: number,
): PlacementProblem | null {
  if (!Number.isInteger(tile) || tile < 0 || tile >= owner.length) return "notYourLand";
  if (!isLand(map, tile)) return "water";
  if (owner[tile] !== playerId) return "notYourLand";
  const spacing = rules.buildings.minSpacing;
  for (const b of buildings) {
    if (withinRange(map, b.tile, tile, spacing - 1)) return "tooClose";
  }
  return null;
}

const PLACEMENT_REASON: Record<PlacementProblem, string> = {
  notYourLand: "you can only build on your own land",
  water: "you can only build on land",
  tooClose: "too close to another building",
};

function busy(building: Building): boolean {
  return building.readyTick >= 0;
}

/** Handles `build`. Returns a rejection reason, or null on success. */
export function applyBuild(
  world: World,
  player: Player,
  type: BuildingType,
  tile: number,
): string | null {
  const rules = world.rules;
  if (!buildingsEnabled(rules)) return "there are no buildings in this game";
  if (world.phase !== "playing") return "the match hasn't started";
  if (!isBuildingType(type)) return "unknown building";
  const problem = placementProblem(rules, world.map, world.owner, world.buildings, player.id, tile);
  if (problem) return PLACEMENT_REASON[problem];
  const price = buildingPrice(rules, type, 1, levelsOwned(world.buildings, player.id, type));
  if (player.gold < price) return "not enough gold";

  player.gold -= price;
  const building: Building = {
    id: world.nextBuildingId++,
    type,
    owner: player.id,
    tile,
    level: 0,
    targetLevel: 1,
    startTick: world.tick,
    readyTick: world.tick + levelRules(rules, type, 1).buildTicks,
    paid: price,
  };
  world.buildings.push(building);
  world.buildingAt[tile] = building.id;
  world.events.push({
    type: "buildingStarted",
    buildingId: building.id,
    playerId: player.id,
    buildingType: type,
    tile,
    level: 1,
    gold: price,
  });
  return null;
}

/** Handles `upgrade`. */
export function applyUpgrade(world: World, player: Player, buildingId: number): string | null {
  const rules = world.rules;
  if (!buildingsEnabled(rules)) return "there are no buildings in this game";
  if (world.phase !== "playing") return "the match hasn't started";
  const building = findBuilding(world, buildingId);
  if (!building || building.owner !== player.id) return "not your building";
  if (busy(building)) return "it is still being built";
  if (building.level >= MAX_LEVEL) return "already at the top level";
  const level = building.level + 1;
  const price = buildingPrice(
    rules,
    building.type,
    level,
    levelsOwned(world.buildings, player.id, building.type),
  );
  if (player.gold < price) return "not enough gold";

  player.gold -= price;
  building.targetLevel = level;
  building.startTick = world.tick;
  building.readyTick = world.tick + levelRules(rules, building.type, level).buildTicks;
  building.paid = price;
  world.events.push({
    type: "buildingStarted",
    buildingId: building.id,
    playerId: player.id,
    buildingType: building.type,
    tile: building.tile,
    level,
    gold: price,
  });
  return null;
}

/** Handles `cancelBuild`: stops a construction (the building goes) or an upgrade (it stays). */
export function applyCancelBuild(world: World, player: Player, buildingId: number): string | null {
  if (!buildingsEnabled(world.rules)) return "there are no buildings in this game";
  const building = findBuilding(world, buildingId);
  if (!building || building.owner !== player.id) return "not your building";
  if (!busy(building)) return "nothing is being built there";
  const refund = Math.floor(building.paid * world.rules.buildings.cancelRefund);
  player.gold += refund;
  world.events.push({ type: "buildingCancelled", buildingId, playerId: player.id, refund });
  if (building.level === 0) {
    removeBuilding(world, building, null, "cancelled");
  } else {
    building.targetLevel = building.level;
    idle(building);
  }
  return null;
}

/**
 * Tick system (step 5b, after the fighting): buildings on captured tiles change hands or
 * are destroyed, finished constructions start working, and each player's bonus is summed.
 */
export function updateBuildings(world: World): void {
  if (world.buildingTileChanges.length > 0) {
    for (const tile of world.buildingTileChanges) settleCapture(world, tile);
    world.buildingTileChanges.length = 0;
  }
  for (const building of world.buildings) {
    if (busy(building) && world.tick >= building.readyTick) {
      building.level = building.targetLevel;
      idle(building);
      world.events.push({
        type: "buildingCompleted",
        buildingId: building.id,
        playerId: building.owner,
        buildingType: building.type,
        tile: building.tile,
        level: building.level,
      });
    }
  }
  sumBonuses(world);
}

export function findBuilding(world: World, id: number): Building | undefined {
  if (!Number.isInteger(id)) return undefined;
  // Ids ascend, so a binary search finds it without an index.
  const list = world.buildings;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = list[mid]!;
    if (b.id === id) return b;
    if (b.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

function idle(building: Building): void {
  building.startTick = -1;
  building.readyTick = -1;
  building.paid = 0;
}

function settleCapture(world: World, tile: number): void {
  const building = findBuilding(world, world.buildingAt[tile]!);
  if (!building) return;
  const newOwner = world.owner[tile]!;
  if (newOwner === building.owner) return; // taken and retaken within the tick
  const from = building.owner;
  const taker = getPlayer(world, newOwner);
  // The taker gets what works: an unfinished building is lost, an upgrade is cancelled.
  const level = building.level;
  if (
    newOwner === NEUTRAL ||
    !taker ||
    isTribe(taker) || // tribes never keep buildings (they are filler, D-017)
    world.rules.buildings.types[building.type].onCapture === "destroy" ||
    level < 1
  ) {
    removeBuilding(world, building, newOwner === NEUTRAL ? null : newOwner, "captured");
    return;
  }
  building.owner = newOwner;
  building.level = level;
  building.targetLevel = level;
  idle(building);
  world.events.push({
    type: "buildingCaptured",
    buildingId: building.id,
    from,
    to: newOwner,
    buildingType: building.type,
    tile,
    level,
  });
}

function removeBuilding(
  world: World,
  building: Building,
  by: PlayerId | null,
  reason: "captured" | "cancelled",
): void {
  world.buildings = world.buildings.filter((b) => b !== building);
  world.buildingAt[building.tile] = -1;
  world.events.push({
    type: "buildingDestroyed",
    buildingId: building.id,
    playerId: building.owner,
    buildingType: building.type,
    tile: building.tile,
    by,
    reason,
  });
}

function sumBonuses(world: World): void {
  for (const player of world.players) {
    const bonus = player.bonus;
    bonus.capacity = 0;
    bonus.growth = 0;
    bonus.income = 0;
    bonus.mobilizeDiscount = 0;
  }
  const rules = world.rules;
  for (const building of world.buildings) {
    if (building.level < 1) continue;
    const effect = levelRules(rules, building.type, building.level);
    const bonus = world.players[building.owner - 1]!.bonus;
    bonus.capacity += effect.capacity ?? 0;
    bonus.growth += effect.growthBonus ?? 0;
    bonus.income += effect.income ?? 0;
    bonus.mobilizeDiscount = Math.max(bonus.mobilizeDiscount, effect.mobilizeDiscount ?? 0);
  }
  const maxGrowth = rules.buildings.maxGrowthBonus;
  for (const player of world.players) {
    if (player.bonus.growth > maxGrowth) player.bonus.growth = maxGrowth;
  }
}
