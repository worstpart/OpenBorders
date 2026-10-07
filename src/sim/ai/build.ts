/**
 * How nations build (GAME_DESIGN.md §3.17): with the same `build` / `upgrade` / `buildWall`
 * / `upgradeWall` commands and prices as a player. Tribes never build.
 *
 * A nation weighs every option — a new Housing or Factory (while it has room: one
 * building per `tilesPerBuilding` tiles), the next level of each building it owns, a new
 * wall and the next level of each wall — by **value per gold**, and picks as its goal the
 * best one it can reach within `goalHorizonTicks` of income:
 *  - capacity counts one per troop;
 *  - a growth bonus counts as that share of its peak growth for `growthHorizonTicks`;
 *  - gold per tick counts for `incomeHorizonTicks`, and a Mobilize discount as that share
 *    of the gold it earns over the same time;
 *  - a wall level counts as `wallWorth` × capacity × the personality's `fortifyWeight`,
 *    in proportion to its length (a rough "defenders it is worth"), and only while it
 *    faces a threat.
 * An Airport (§3.17.7) counts as `airportWorth` × capacity, and only while a friend it could
 * help only by air (a teammate or human ally it doesn't border) is losing a war — more
 * troops attacking it than it has at home, the same need that makes it airlift (bot.ts) — and
 * close enough for an Airport in the middle of its land to reach; one is enough. (Valued for any distant friend, nations built 3–7 per team game and airlifted
 * almost never: 2B.1 headless runs.) It stands on plains, deep inside like the rest.
 * A SAM (§3.17.7, 2B.2) is worth something only under an air threat — a working Airport of a
 * player who isn't a friend whose range (plus `samThreatMargin`) reaches one of the bot's
 * Housing, Factories or Airports: then `samWorth` × capacity per interceptor, times the share
 * of those buildings' levels it covers (that no SAM of the bot covers yet, for a new one). It
 * stands among them (at most `maxSams`), and is upgraded by the same measure.
 * Airborne assaults (2B.3): while an enemy nation or human it can't simply walk into — not a
 * land neighbour, or one behind walls — has land within reach of a Military Airport in the
 * middle of its land and is weak enough that one airdrop would be worth it (the same estimate
 * as an attack, with the airborne losses), the Airport and its upgrade to level II are worth
 * `assaultWorth` × capacity together, each step its share of the price. (Valued for any
 * enemy in reach, Continent nations built 0.8 Airports a game and never flew an assault: their
 * enemies' armies were too big for a lift — 2B.3 headless runs.) Worth less per gold than the
 * economy, so it comes late.
 * Escalating prices make the next new building dearer, so upgrades win in time. Gold is
 * also its war chest (§3.16, Mobilize right before attacking a player); while saving, it
 * keeps part of the goal's price out of the chest (`saving`, by personality), and builds
 * once it can pay — one construction at a time, never while losing a war at home (except
 * a wall on the threatened front). New buildings go deep inside its land (sampled tiles,
 * scored by how far they are from the nearest tile it doesn't own), where they are
 * hardest to capture.
 *
 * Walls (§3.17.6, D-024): a neighbouring nation or human that isn't a friend and is
 * attacking the bot, or has at least `threatStrength` of its troops, is a threat. Walls come
 * after the first Housing or Factory (unless under attack). A new
 * wall (up to `maxWalls`) is one straight line `wallDepth` tiles behind a threatened border
 * tile that no wall guards yet, across the front (perpendicular to the way in), up to
 * `wallLength` tiles and clipped to the bot's own clear land.
 */
import { attackLossFactor, expectedLandShare, tileCostOfAll } from "../battle.ts";
import type { Command } from "../commands.ts";
import { isCoast, isLand, tileAt, type GameMap } from "../map/gameMap.ts";
import { detPow } from "../math/detmath.ts";
import {
  BUILDING_TYPES,
  type BuildingLevelRules,
  type BuildingType,
  type Personality,
} from "../rules.ts";
import {
  buildingAvailable,
  buildingPrice,
  buildingsEnabled,
  levelRules,
  levelsOwned,
  maxLevel,
  placementProblem,
} from "../systems/buildings.ts";
import { distanceSq, withinRange } from "../geometry.ts";
import { bordersTarget } from "../systems/attacks.ts";
import { airportRange, ASSAULT_LEVEL, samInterceptors } from "../systems/flights.ts";
import { areFriendly, isAllied } from "../systems/diplomacy.ts";
import { expectedTradePerTick } from "../systems/trade.ts";
import { wallLevelsOwned, wallPlan, wallPrice } from "../systems/walls.ts";
import {
  isTribe,
  sameTeam,
  NEUTRAL,
  type Building,
  type Player,
  type PlayerId,
  type Wall,
  type World,
} from "../world.ts";

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
/** A wall guards front tiles within this many tiles beyond its depth. */
const GUARD_SLACK = 3;
/** Shorter walls aren't worth drawing. */
const MIN_WALL_TILES = 8;
/** Front tiles checked for a gap in the walls, at most (every few, nearest the threat first). */
const FRONT_SAMPLES = 60;

/** The building option a nation aims for: the best value per gold it can reach soon. */
interface Goal {
  readonly price: number;
  /** An upgrade, or a new building (its site is chosen when it is actually built). */
  readonly upgrade: number | null;
  readonly newType: BuildingType | null;
  /** A wall upgrade, or a new wall's corner points. */
  readonly wallUpgrade: number | null;
  readonly wallPoints: readonly number[] | null;
}

function buildingGoal(world: World, bot: Player): Goal | null {
  const rules = world.rules;
  if (!buildingsEnabled(rules) || world.phase !== "playing" || bot.lastIncome <= 0) return null;
  const ai = rules.ai.build;
  const reach = bot.lastIncome * ai.goalHorizonTicks;
  const mine: Building[] = [];
  for (const b of world.buildings) if (b.owner === bot.id) mine.push(b);
  const walls: Wall[] = [];
  for (const w of world.walls) if (w.owner === bot.id) walls.push(w);
  // One construction at a time.
  if (mine.some((b) => b.readyTick >= 0) || walls.some((w) => w.readyTick >= 0)) return null;

  let goal: Goal | null = null;
  let bestScore = 0;
  const consider = (price: number, value: number, option: Omit<Goal, "price">) => {
    const score = value / price;
    if (price <= reach && score > bestScore) {
      goal = { price, ...option };
      bestScore = score;
    }
  };
  const none = { upgrade: null, newType: null, wallUpgrade: null, wallPoints: null };
  const air = airDefence(world, bot, mine);
  // Worked out only when an Airport option is affordable soon (it scans enemies' borders).
  let prospect: boolean | null = null;
  const assaults = () => (prospect ??= assaultProspect(world, bot));
  for (const b of mine) {
    if (b.level >= maxLevel(rules, b.type)) continue;
    const level = b.level + 1;
    const price = buildingPrice(rules, b.type, level, levelsOwned(world.buildings, bot.id, b.type));
    if (b.type === "airport") {
      if (price <= reach && assaults()) {
        const value = assaultValue(world, bot, level) - assaultValue(world, bot, b.level);
        consider(price, value, { ...none, upgrade: b.id });
      }
      continue;
    }
    const value =
      b.type === "sam"
        ? air
          ? samValue(world, bot, air, b.tile, level, null) -
            samValue(world, bot, air, b.tile, b.level, null)
          : 0
        : worth(world, bot, levelRules(rules, b.type, level), b.tile) -
          worth(world, bot, levelRules(rules, b.type, b.level), b.tile);
    consider(price, value, { ...none, upgrade: b.id });
  }
  if (mine.length < Math.floor(bot.tiles / ai.tilesPerBuilding)) {
    for (const type of BUILDING_TYPES) {
      if (!buildingAvailable(rules, type)) continue;
      // One Port is enough (its speed doesn't stack); it needs a coast.
      const coast = type === "port" ? anyCoast(world, bot) : -1;
      if (type === "port" && (mine.some((b) => b.type === "port") || coast < 0)) continue;
      // One Airport, and only for a friend it can't reach over land — or for assaults.
      const needy = type === "airport" && friendInNeed(world, bot);
      if (type === "airport" && mine.some((b) => b.type === "airport")) continue;
      // SAMs only under an air threat, a few at most, where they cover the most.
      const samCenter = type === "sam" && air ? bestSamCenter(world, bot, air) : -1;
      if (
        type === "sam" &&
        (samCenter < 0 || mine.filter((b) => b.type === "sam").length >= ai.maxSams)
      )
        continue;
      const price = buildingPrice(rules, type, 1, levelsOwned(world.buildings, bot.id, type));
      const assault = type === "airport" && price <= reach && assaults();
      if (type === "airport" && !needy && !assault) continue;
      const value =
        type === "airport"
          ? (needy ? ai.airportWorth * bot.capacity : 0) +
            (assault ? assaultValue(world, bot, 1) : 0)
          : type === "sam"
            ? samValue(world, bot, air!, samCenter, 1, mine)
            : worth(world, bot, levelRules(rules, type, 1), coast);
      consider(price, value, { ...none, newType: type });
    }
  }

  // Walls come after the economy: not before the first Housing or Factory, unless the
  // nation is already under attack (user, 2.6: nations looked like they only built walls).
  const attacked = world.attacks.some((x) => x.target === bot.id && x.retreatTick < 0);
  if (mine.length === 0 && !attacked) return goal;
  const front = threatenedFront(world, bot);
  if (front.length === 0) return goal;
  const frontSet = new Set(front);
  const owned = wallLevelsOwned(world.walls, bot.id);
  for (const w of walls) {
    if (w.level >= rules.walls.levels.length || !guards(world, w, frontSet)) continue;
    const price = wallPrice(rules, w.level + 1, w.intact, owned);
    const value =
      wallWorth(world, bot, w.level + 1, w.intact) - wallWorth(world, bot, w.level, w.intact);
    consider(price, value, { ...none, wallUpgrade: w.id });
  }
  if (walls.length < ai.maxWalls[bot.brain?.personality ?? "expander"]) {
    const points = planWall(world, bot, front);
    if (points) {
      const tiles = points.tiles;
      const price = wallPrice(rules, 1, tiles, owned);
      consider(price, wallWorth(world, bot, 1, tiles), { ...none, wallPoints: points.points });
    }
  }
  return goal;
}

/** A nation's building decision for this think, or null: its goal, once it can pay for it. */
export function decideBuild(world: World, bot: Player, incoming: number): Command | null {
  const goal: Goal | null = buildingGoal(world, bot);
  if (!goal || bot.gold < goal.price) return null;
  if (goal.wallPoints) return { type: "buildWall", points: goal.wallPoints };
  // Losing a war at home: no investments — except a wall on the threatened front.
  if (incoming > bot.homeTroops * 0.5) return null;
  if (goal.wallUpgrade !== null) return { type: "upgradeWall", wallId: goal.wallUpgrade };
  if (goal.upgrade !== null) return { type: "upgrade", buildingId: goal.upgrade };
  const type = goal.newType!;
  const tile =
    world.rules.buildings.types[type].placement === "coast"
      ? portSite(world, bot)
      : type === "sam"
        ? samSite(world, bot)
        : buildSite(world, bot, type);
  return tile < 0 ? null : { type: "build", buildingType: type, tile };
}

/** Gold a nation keeps out of its war chest while saving for its goal. */
export function buildingReserve(world: World, bot: Player, personality: Personality): number {
  const goal = buildingGoal(world, bot);
  if (!goal) return 0;
  return Math.min(bot.gold, goal.price * world.rules.ai.build.saving[personality]);
}

/**
 * The bot's border tiles facing a threat (GAME_DESIGN.md §3.17.6), nearest first to the
 * strongest threat's start; empty when nobody threatens it.
 */
function threatenedFront(world: World, bot: Player): number[] {
  const { map } = world;
  const width = map.width;
  const o = world.owner;
  const strength = (p: Player) => p.homeTroops + p.fieldTroops;
  const minStrength = world.rules.ai.build.threatStrength * strength(bot);
  const verdict = new Map<PlayerId, boolean>();
  let main: Player | null = null;
  const isThreat = (id: PlayerId): boolean => {
    if (id === bot.id || id === NEUTRAL) return false;
    const known = verdict.get(id);
    if (known !== undefined) return known;
    const p = world.players[id - 1]!;
    const threat =
      p.alive &&
      !isTribe(p) &&
      !areFriendly(world, bot.id, id) &&
      (strength(p) >= minStrength ||
        world.attacks.some((a) => a.attacker === id && a.target === bot.id));
    verdict.set(id, threat);
    if (threat && (!main || strength(p) > strength(main))) main = p;
    return threat;
  };
  const front: number[] = [];
  for (const tile of bot.border) {
    const x = tile % width;
    if (
      (tile >= width && isThreat(o[tile - width]!)) ||
      (tile + width < o.length && isThreat(o[tile + width]!)) ||
      (x > 0 && isThreat(o[tile - 1]!)) ||
      (x < width - 1 && isThreat(o[tile + 1]!))
    ) {
      front.push(tile);
    }
  }
  const target = main as Player | null;
  if (target && target.spawnTile >= 0 && o[target.spawnTile] === target.id) {
    const spawn = target.spawnTile;
    front.sort((a, b) => distanceSq(map, a, spawn) - distanceSq(map, b, spawn) || a - b);
  }
  return front;
}

/** True when one of the bot's walls stands within reach of `tile` (it is guarded). */
function guarded(world: World, bot: Player, tile: number): boolean {
  const { map } = world;
  const reach = world.rules.ai.build.wallDepth + GUARD_SLACK;
  const x0 = tile % map.width;
  const y0 = Math.floor(tile / map.width);
  for (let y = Math.max(0, y0 - reach); y <= Math.min(map.height - 1, y0 + reach); y++) {
    for (let x = Math.max(0, x0 - reach); x <= Math.min(map.width - 1, x0 + reach); x++) {
      const id = world.wallAt[y * map.width + x]!;
      if (id >= 0 && world.walls.some((w) => w.id === id && w.owner === bot.id)) return true;
    }
  }
  return false;
}

/** True when the wall stands near a threatened front tile (checks every few wall tiles). */
function guards(world: World, wall: Wall, front: ReadonlySet<number>): boolean {
  const { map } = world;
  const reach = world.rules.ai.build.wallDepth + GUARD_SLACK;
  for (let k = 0; k < wall.tiles.length; k += 4) {
    const tile = wall.tiles[k]!;
    if (world.wallAt[tile] !== wall.id) continue;
    const x0 = tile % map.width;
    const y0 = Math.floor(tile / map.width);
    for (let y = Math.max(0, y0 - reach); y <= Math.min(map.height - 1, y0 + reach); y++) {
      for (let x = Math.max(0, x0 - reach); x <= Math.min(map.width - 1, x0 + reach); x++) {
        if (front.has(y * map.width + x)) return true;
      }
    }
  }
  return false;
}

/** What a wall level of `tiles` tiles is worth to this bot, in troops (see the header). */
function wallWorth(world: World, bot: Player, level: number, tiles: number): number {
  if (level < 1) return 0;
  const ai = world.rules.ai.build;
  const weight = ai.fortifyWeight[bot.brain?.personality ?? "expander"];
  return ai.wallWorth[level - 1]! * bot.capacity * weight * Math.min(1, tiles / ai.wallLength);
}

/**
 * A straight wall across the first unguarded threatened front tile: `wallDepth` tiles
 * inside, perpendicular to the way in, as long as the bot's clear land allows (up to
 * `wallLength`). Null if none fits.
 */
function planWall(
  world: World,
  bot: Player,
  front: readonly number[],
): { points: number[]; tiles: number } | null {
  const { map } = world;
  const ai = world.rules.ai.build;
  const step = Math.max(1, Math.floor(front.length / FRONT_SAMPLES));
  let target = -1;
  for (let k = 0; k < front.length && target < 0; k += step) {
    if (!guarded(world, bot, front[k]!)) target = front[k]!;
  }
  if (target < 0) return null;

  let sumX = 0;
  let sumY = 0;
  for (const tile of bot.border) {
    sumX += tile % map.width;
    sumY += Math.floor(tile / map.width);
  }
  const count = Math.max(1, bot.border.size);
  const fx = target % map.width;
  const fy = Math.floor(target / map.width);
  let nx = sumX / count - fx;
  let ny = sumY / count - fy;
  const length = Math.sqrt(nx * nx + ny * ny);
  if (length < 1) return null;
  nx /= length;
  ny /= length;
  const cx = fx + nx * ai.wallDepth;
  const cy = fy + ny * ai.wallDepth;
  const clear = (x: number, y: number): boolean => {
    if (!inBounds(map, x, y)) return false;
    const tile = tileAt(map, x, y);
    return (
      world.owner[tile] === bot.id &&
      isLand(map, tile) &&
      world.buildingAt[tile]! < 0 &&
      world.wallAt[tile]! < 0
    );
  };
  if (!clear(Math.round(cx), Math.round(cy))) return null;
  // Walk both ways along the wall line (perpendicular to n) while the land is clear.
  const half = Math.floor(ai.wallLength / 2);
  const end = (sign: number): [number, number] => {
    let last: [number, number] = [Math.round(cx), Math.round(cy)];
    for (let s = 1; s <= half; s++) {
      const x = Math.round(cx - ny * s * sign);
      const y = Math.round(cy + nx * s * sign);
      if (!clear(x, y)) break;
      last = [x, y];
    }
    return last;
  };
  let a = end(-1);
  let b = end(1);
  // The straight line between the ends may still clip something: pull them in until it fits.
  for (let tries = 0; tries < 8; tries++) {
    const points = [tileAt(map, a[0], a[1]), tileAt(map, b[0], b[1])];
    const plan = wallPlan(
      world.rules,
      map,
      world.owner,
      (t) => world.buildingAt[t]! >= 0,
      (t) => world.wallAt[t]! >= 0,
      bot.id,
      points,
    );
    if (plan.tiles.length < MIN_WALL_TILES) return null;
    if (!plan.problem) return { points, tiles: plan.tiles.length };
    a = [Math.round((a[0] * 3 + cx) / 4), Math.round((a[1] * 3 + cy) / 4)];
    b = [Math.round((b[0] * 3 + cx) / 4), Math.round((b[1] * 3 + cy) / 4)];
  }
  return null;
}

/**
 * What a level's effects are worth to this bot, in troop-equivalents. A Port's faster
 * boats and extra slots count as `portWorth` × capacity per boat speed step (§3.18); its
 * trade as the gold it would bring now from the partner Ports on its sea (§3.19).
 */
function worth(world: World, bot: Player, effect: BuildingLevelRules, tile = -1): number {
  const ai = world.rules.ai.build;
  const troops = world.rules.troops;
  const peakGrowth = troops.growthScale * detPow(Math.max(1, bot.capacity), troops.growthExponent);
  const income = bot.lastIncome * ai.incomeHorizonTicks;
  return (
    (effect.capacity ?? 0) +
    (effect.growthBonus ?? 0) * peakGrowth * ai.growthHorizonTicks +
    (effect.income ?? 0) * ai.incomeHorizonTicks +
    (effect.mobilizeDiscount ?? 0) * income +
    ((effect.boatSpeed ?? 1) - 1) * ai.portWorth * bot.capacity +
    expectedTradePerTick(world, bot.id, tile, effect.tradeEveryTicks ?? 0) * ai.incomeHorizonTicks
  );
}

/**
 * True when a friend the bot can help only by air — a living teammate or human ally (the
 * friends nations give troops to) it doesn't border — is losing a war: more troops are
 * attacking it than it has at home — within reach of an Airport near the middle of the bot's
 * land (9/10 of Airport I's range: the site lands somewhere around there).
 */
function friendInNeed(world: World, bot: Player): boolean {
  const middle = landMiddle(world, bot);
  if (middle < 0) return false;
  const reach = Math.floor(levelRules(world.rules, "airport", 1).range! * 0.9);
  for (const friend of world.players) {
    if (!friend.alive || friend.id === bot.id) continue;
    const teammate = sameTeam(world, bot.id, friend.id);
    const humanAlly = friend.kind === "human" && isAllied(world, bot.id, friend.id);
    if (!teammate && !humanAlly) continue;
    let incoming = 0;
    for (const a of world.attacks) {
      if (a.target === friend.id && a.retreatTick < 0) incoming += a.troops;
    }
    if (incoming <= friend.homeTroops || bordersTarget(world, bot, friend.id)) continue;
    for (const tile of friend.border) if (withinRange(world.map, middle, tile, reach)) return true;
  }
  return false;
}

/**
 * True when an enemy nation or human the bot can't simply walk into — not a land neighbour,
 * or one with walls — has land within reach of a Military Airport near the middle of the
 * bot's land (9/10 of its range), and one Military Airport lift (what the bot would send)
 * would take at least the share of their land the bot's personality asks of an attack.
 * Tribes don't count: they are eaten over land.
 */
function assaultProspect(world: World, bot: Player): boolean {
  const rules = world.rules;
  const levels = rules.buildings.types.airport.levels;
  if (!rules.flights.enabled || levels.length < ASSAULT_LEVEL) return false;
  const middle = landMiddle(world, bot);
  if (middle < 0) return false;
  const military = levels[ASSAULT_LEVEL - 1]!;
  const reach = Math.floor((military.range ?? 0) * 0.9);
  const style = rules.ai.personalities[bot.brain?.personality ?? "expander"];
  const lift = Math.min(
    bot.capacity * (military.liftShare ?? 0),
    style.attackMaxShare * Math.max(bot.homeTroops, bot.capacity * style.attackAt),
  );
  const loss = attackLossFactor(rules, false, false, false, 1) * rules.flights.airborneLoss;
  for (const enemy of world.players) {
    if (!enemy.alive || enemy.id === bot.id || enemy.tiles === 0 || isTribe(enemy)) continue;
    if (areFriendly(world, bot.id, enemy.id)) continue;
    const gain = Math.min(
      expectedLandShare(rules, lift, Math.max(1, enemy.homeTroops), loss),
      lift / tileCostOfAll(rules, enemy.tiles, enemy.homeTroops, loss),
    );
    if (gain < style.minLandGain) continue;
    if (
      bordersTarget(world, bot, enemy.id) &&
      !world.walls.some((w) => w.owner === enemy.id && w.level >= 1)
    )
      continue;
    const heart = enemy.spawnTile;
    if (
      heart >= 0 &&
      world.owner[heart] === enemy.id &&
      withinRange(world.map, middle, heart, reach)
    )
      return true;
    for (const tile of enemy.border) if (withinRange(world.map, middle, tile, reach)) return true;
  }
  return false;
}

/**
 * What an Airport at `level` is worth for assaults (2B.3): `assaultWorth` × capacity for the
 * Military Airport, each level up to it counting its share of the price.
 */
function assaultValue(world: World, bot: Player, level: number): number {
  const levels = world.rules.buildings.types.airport.levels;
  if (level < 1 || levels.length < ASSAULT_LEVEL) return 0;
  let total = 0;
  let paid = 0;
  for (let l = 1; l <= ASSAULT_LEVEL; l++) {
    total += levels[l - 1]!.cost;
    if (l <= level) paid += levels[l - 1]!.cost;
  }
  return world.rules.ai.build.assaultWorth * bot.capacity * (paid / total);
}

/** What SAMs guard (GAME_DESIGN.md §3.17.7): the bot's economy and its Airports. */
const GUARDED: ReadonlySet<BuildingType> = new Set<BuildingType>(["housing", "factory", "airport"]);

/** The bot's guarded buildings while an air threat hangs over them (see the header). */
interface AirDefence {
  readonly guarded: readonly Building[];
  /** Their levels together (the ones being built count at their target level). */
  readonly totalLevels: number;
}

/** The bot's guarded buildings if a hostile Airport can reach one of them, else null. */
function airDefence(world: World, bot: Player, mine: readonly Building[]): AirDefence | null {
  const rules = world.rules;
  if (!rules.flights.enabled) return null;
  const guarded = mine.filter((b) => GUARDED.has(b.type));
  if (guarded.length === 0) return null;
  const margin = rules.ai.build.samThreatMargin;
  const threat = world.buildings.some(
    (a) =>
      a.type === "airport" &&
      a.level >= 1 &&
      a.owner !== bot.id &&
      !areFriendly(world, bot.id, a.owner) &&
      guarded.some((g) => withinRange(world.map, a.tile, g.tile, airportRange(rules, a) + margin)),
  );
  if (!threat) return null;
  let totalLevels = 0;
  for (const g of guarded) totalLevels += g.targetLevel;
  return { guarded, totalLevels };
}

/** A SAM's radius at `level` (0 below level I). */
function samRadiusAt(world: World, level: number): number {
  return level >= 1 ? (levelRules(world.rules, "sam", level).range ?? 0) : 0;
}

/**
 * Guarded levels a SAM of `level` at `tile` covers; with `others`, only those that none of
 * the bot's SAMs among them covers yet.
 */
function coveredLevels(
  world: World,
  air: AirDefence,
  tile: number,
  level: number,
  others: readonly Building[] | null,
): number {
  const radius = samRadiusAt(world, level);
  let levels = 0;
  for (const g of air.guarded) {
    if (!withinRange(world.map, tile, g.tile, radius)) continue;
    const covered = others?.some(
      (s) =>
        s.type === "sam" &&
        withinRange(world.map, s.tile, g.tile, samRadiusAt(world, Math.max(1, s.targetLevel))),
    );
    if (!covered) levels += g.targetLevel;
  }
  return levels;
}

/** What a SAM of `level` at `tile` is worth to the bot, in troop-equivalents (see the header). */
function samValue(
  world: World,
  bot: Player,
  air: AirDefence,
  tile: number,
  level: number,
  others: readonly Building[] | null,
): number {
  if (level < 1 || air.totalLevels === 0) return 0;
  const share = coveredLevels(world, air, tile, level, others) / air.totalLevels;
  return world.rules.ai.build.samWorth * bot.capacity * samInterceptors(world.rules, level) * share;
}

/**
 * The guarded building a new SAM would cover the most uncovered levels around (the first
 * among equals, by id), or -1 when everything is covered already.
 */
function bestSamCenter(world: World, bot: Player, air: AirDefence): number {
  const mine = world.buildings.filter((b) => b.owner === bot.id);
  let best = -1;
  let bestLevels = 0;
  for (const g of air.guarded) {
    const levels = coveredLevels(world, air, g.tile, 1, mine);
    if (levels > bestLevels) {
      best = g.tile;
      bestLevels = levels;
    }
  }
  return best;
}

/**
 * Where a nation puts a new SAM, or -1: sampled within half a radius of the guarded building
 * it should cover most around; the tile covering the most uncovered levels wins, then the
 * deeper one (harder to capture).
 */
function samSite(world: World, bot: Player): number {
  const mine = world.buildings.filter((b) => b.owner === bot.id);
  const air = airDefence(world, bot, mine);
  if (!air) return -1;
  const center = bestSamCenter(world, bot, air);
  if (center < 0) return -1;
  const { map } = world;
  const reach = Math.max(2, Math.floor(samRadiusAt(world, 1) / 2));
  const cx = center % map.width;
  const cy = Math.floor(center / map.width);
  let best = -1;
  let bestLevels = 0;
  let bestDepth = 0;
  const samples = world.rules.ai.build.placementSamples;
  for (let k = 0; k < samples; k++) {
    const x = cx + world.rng.nextIntBetween(-reach, reach);
    const y = cy + world.rng.nextIntBetween(-reach, reach);
    if (!inBounds(map, x, y)) continue;
    const tile = tileAt(map, x, y);
    if (world.owner[tile] !== bot.id || !isLand(map, tile) || world.wallAt[tile]! >= 0) continue;
    if (placementProblem(world.rules, map, world.owner, world.buildings, bot.id, tile, "sam"))
      continue;
    const levels = coveredLevels(world, air, tile, 1, mine);
    const depth = depthOf(world, bot, x, y);
    if (levels > bestLevels || (levels === bestLevels && levels > 0 && depth > bestDepth)) {
      best = tile;
      bestLevels = levels;
      bestDepth = depth;
    }
  }
  return best;
}

/** The tile in the middle of the bot's border (roughly the middle of its land), or -1. */
function landMiddle(world: World, bot: Player): number {
  const { map } = world;
  let sumX = 0;
  let sumY = 0;
  for (const tile of bot.border) {
    sumX += tile % map.width;
    sumY += Math.floor(tile / map.width);
  }
  const count = bot.border.size;
  return count === 0 ? -1 : tileAt(map, Math.round(sumX / count), Math.round(sumY / count));
}

/** One of the bot's coast tiles (a Port could stand there), or -1. */
function anyCoast(world: World, bot: Player): number {
  for (const tile of bot.border) if (isCoast(world.map, tile)) return tile;
  return -1;
}

/**
 * A coast tile of the bot's where a Port may stand, or -1: sampled among its coast tiles,
 * preferring the one farthest from other players' land (safest).
 */
function portSite(world: World, bot: Player): number {
  const { map } = world;
  const coast: number[] = [];
  for (const tile of bot.border) if (isCoast(map, tile)) coast.push(tile);
  if (coast.length === 0) return -1;
  let best = -1;
  let bestDepth = 0;
  const samples = world.rules.ai.build.placementSamples;
  for (let k = 0; k < samples; k++) {
    const tile = coast[world.rng.nextInt(coast.length)]!;
    if (world.wallAt[tile]! >= 0) continue;
    if (placementProblem(world.rules, map, world.owner, world.buildings, bot.id, tile, "port"))
      continue;
    const depth = landDepth(world, bot, tile);
    if (depth > bestDepth || (depth === bestDepth && tile < best)) {
      best = tile;
      bestDepth = depth;
    }
  }
  return best;
}

/** Steps (up to DEPTH_REACH) from `tile` to the nearest land the bot doesn't own, on 8 rays. */
function landDepth(world: World, bot: Player, tile: number): number {
  const { map } = world;
  const x = tile % map.width;
  const y = Math.floor(tile / map.width);
  let depth = DEPTH_REACH;
  for (const [dx, dy] of DIRECTIONS) {
    for (let step = 1; step < depth; step++) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      if (!inBounds(map, nx, ny)) break;
      const t = tileAt(map, nx, ny);
      if (isLand(map, t) && world.owner[t] !== bot.id) {
        depth = step;
        break;
      }
    }
  }
  return depth;
}

/**
 * A tile deep inside the bot's land where a building may stand, or -1. Candidates are
 * sampled around the middle of its border (roughly the middle of its land) and around its
 * spawn; the deepest valid one wins.
 */
function buildSite(world: World, bot: Player, type: BuildingType): number {
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
    if (world.wallAt[tile]! >= 0) continue;
    if (placementProblem(world.rules, map, world.owner, world.buildings, bot.id, tile, type))
      continue;
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
