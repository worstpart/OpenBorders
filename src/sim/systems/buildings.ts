/**
 * Buildings (GAME_DESIGN.md §3.17, ARCHITECTURE.md §5.7).
 *
 *  - `build` places a level-I building on your own land (gold up front, a short
 *    construction); `upgrade` raises it to the next level (the current level keeps working
 *    meanwhile); `cancelBuild` stops either and refunds part of the price.
 *  - Prices grow with the levels of that type you already own (escalation).
 *  - The level is the building's health: air strikes (2B.4) and missiles (2B.5) cost levels
 *    (`strikeBuilding`), and a struck building does nothing for a while (`working`).
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
import { isCoast, isLand, Terrain, type GameMap } from "../map/gameMap.ts";
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

/**
 * Building types this game offers: Ports only come with boats (GAME_DESIGN.md §3.18),
 * Airports, SAMs and Missile Silos with flights (§3.17.7–3.17.8: missiles are flights).
 */
export function buildingAvailable(rules: GameRules, type: BuildingType): boolean {
  if (type === "port") return rules.naval.enabled;
  if (type === "airport" || type === "sam" || type === "silo") return rules.flights.enabled;
  return true;
}

/**
 * Factory III's war production (GAME_DESIGN.md §3.17.9, 2B.5): the share of the usual time
 * `building`'s reloads and mission cooldowns take — less than 1 while a working factory of its
 * owner with war production stands within that factory's range of it (the best one counts).
 */
export function warProduction(
  world: World,
  building: { readonly owner: PlayerId; readonly tile: number },
): number {
  let factor = 1;
  const rules = world.rules;
  for (const b of world.buildings) {
    if (b.type !== "factory" || b.owner !== building.owner || !working(b, world.tick)) continue;
    const effect = levelRules(rules, "factory", b.level);
    const share = effect.warProductionFactor ?? 1;
    if (share >= factor) continue;
    if (withinRange(world.map, b.tile, building.tile, effect.warProductionRange ?? 0)) {
      factor = share;
    }
  }
  return factor;
}

/** `ticks` shortened by war production for `building` (whole ticks). */
export function producedTicks(
  world: World,
  building: { readonly owner: PlayerId; readonly tile: number },
  ticks: number,
): number {
  const factor = warProduction(world, building);
  return factor === 1 ? ticks : Math.round(ticks * factor);
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

/** The top level of a building type (3; Port 2 until Phase 2B). */
export function maxLevel(rules: GameRules, type: BuildingType): number {
  return rules.buildings.types[type].levels.length;
}

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
export type PlacementProblem = "notYourLand" | "water" | "notCoast" | "notPlains" | "tooClose";

export function placementProblem(
  rules: GameRules,
  map: GameMap,
  owner: ArrayLike<number>,
  buildings: readonly { tile: number }[],
  playerId: PlayerId,
  tile: number,
  type?: BuildingType,
): PlacementProblem | null {
  if (!Number.isInteger(tile) || tile < 0 || tile >= owner.length) return "notYourLand";
  if (!isLand(map, tile)) return "water";
  if (owner[tile] !== playerId) return "notYourLand";
  const placement = type ? rules.buildings.types[type].placement : "land";
  if (placement === "coast" && !isCoast(map, tile)) return "notCoast";
  if (placement === "plains" && map.terrain[tile] !== Terrain.Plains) return "notPlains";
  const spacing = rules.buildings.minSpacing;
  for (const b of buildings) {
    if (withinRange(map, b.tile, tile, spacing - 1)) return "tooClose";
  }
  return null;
}

const PLACEMENT_REASON: Record<PlacementProblem, string> = {
  notYourLand: "you can only build on your own land",
  water: "you can only build on land",
  notCoast: "a port must stand on the coast",
  notPlains: "an airport needs flat land (plains)",
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
  if (!buildingAvailable(rules, type)) {
    return type === "port"
      ? "there are no boats in this game"
      : "there are no flights in this game";
  }
  const problem = placementProblem(
    rules,
    world.map,
    world.owner,
    world.buildings,
    player.id,
    tile,
    type,
  );
  if (problem) return PLACEMENT_REASON[problem];
  if (world.wallAt[tile]! >= 0) return "there is a wall there";
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
    reloads: [],
    cooldowns: [],
    disabledUntil: -1,
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
  if (building.level >= maxLevel(rules, building.type)) return "already at the top level";
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
    // Charges that are back are forgotten (Phase 2B), so the state holds only pending ones.
    if (building.reloads.length > 0 && building.reloads[0]! <= world.tick) {
      building.reloads = building.reloads.filter((t) => t > world.tick);
    }
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

/**
 * Charges (Phase 2B — SAM interceptors, silo slots): how many of a building's `max` charges
 * are ready at `tick`.
 */
export function readyCharges(
  building: { readonly reloads: readonly number[] },
  max: number,
  tick: number,
): number {
  let away = 0;
  for (const back of building.reloads) if (back > tick) away++;
  return Math.max(0, max - away);
}

/**
 * Spends one charge at `tick`. Charges reload one at a time: this one is back `reloadTicks`
 * after the one before it (or after now, if none is reloading).
 */
export function spendCharge(building: Building, tick: number, reloadTicks: number): void {
  const pending = building.reloads.filter((t) => t > tick);
  pending.push(Math.max(pending.at(-1) ?? tick, tick) + reloadTicks);
  building.reloads = pending;
}

/** Ticks until mission `slot` of a building is ready again (0 = ready; Phase 2B). */
export function cooldownLeft(building: Building, slot: number, tick: number): number {
  return Math.max(0, (building.cooldowns[slot] ?? -1) - tick);
}

/** Starts mission `slot`'s cooldown: ready again `ticks` after `tick`. */
export function startCooldown(building: Building, slot: number, tick: number, ticks: number): void {
  while (building.cooldowns.length <= slot) building.cooldowns.push(-1);
  building.cooldowns[slot] = tick + ticks;
}

/**
 * True when a building works at `tick`: finished (level I or more) and not disabled by an air
 * strike (2B.4). A disabled building gives no bonus, fires nothing and flies no missions.
 */
export function working(
  building: { readonly level: number; readonly disabledUntil: number },
  tick: number,
): boolean {
  return building.level >= 1 && building.disabledUntil <= tick;
}

/** Ticks until a struck building works again (0 = not disabled). */
export function disabledLeft(building: { readonly disabledUntil: number }, tick: number): number {
  return Math.max(0, building.disabledUntil - tick);
}

/**
 * An air strike hits a building (GAME_DESIGN.md §3.17.7, 2B.4; missiles in 2B.5): it loses
 * `levels` levels — below level I it is destroyed, and an upgrade in progress is lost — and
 * does nothing for `disableTicks`. Returns its level afterwards (0 = destroyed).
 */
export function strikeBuilding(
  world: World,
  building: Building,
  levels: number,
  disableTicks: number,
  by: PlayerId,
): number {
  const before = building.level;
  const level = before - levels;
  if (level < 1) {
    world.events.push({
      type: "buildingStruck",
      buildingId: building.id,
      playerId: building.owner,
      by,
      buildingType: building.type,
      tile: building.tile,
      levelBefore: before,
      level: 0,
      disabledUntil: -1,
    });
    removeBuilding(world, building, by, "struck");
    return 0;
  }
  if (levels > 0) {
    building.level = level;
    if (building.targetLevel !== level) {
      // The upgrade under way is lost with the level it was built on.
      building.targetLevel = level;
      idle(building);
    }
  }
  building.disabledUntil = Math.max(building.disabledUntil, world.tick + disableTicks);
  world.events.push({
    type: "buildingStruck",
    buildingId: building.id,
    playerId: building.owner,
    by,
    buildingType: building.type,
    tile: building.tile,
    levelBefore: before,
    level,
    disabledUntil: building.disabledUntil,
  });
  return level;
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
  reason: "captured" | "cancelled" | "struck",
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
    if (!working(building, world.tick)) continue;
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
