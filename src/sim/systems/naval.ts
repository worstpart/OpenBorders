/**
 * Boats — naval transport (GAME_DESIGN.md §3.18, milestone 2.7).
 *
 *  - `boat` sends a share of your home troops from your coast to the coast of the land you
 *    clicked (a player's, or neutral land). Any coast will do — no Port needed — but only
 *    across one connected sea: the landing is the target's coast tile nearest the click,
 *    the launch your coast tile on that sea that gets there soonest (a Port nearby makes
 *    boats faster, so a Port farther away can win).
 *  - The route is the shortest path over sea tiles (8 directions, never cutting a corner of
 *    land), found once at launch. The boat's position is a pure function of the tick, so
 *    nothing moves it tick by tick and the client can draw it from the route alone.
 *  - Troops aboard count toward the owner's capacity (like an army in the field).
 *  - On arrival the troops land as a **beachhead attack** (attacks.ts): it takes the landing
 *    tile and spreads from it, never merging with the land army. If the landing tile became
 *    the owner's or a friend's meanwhile, the troops simply go home.
 *  - `recallBoat` turns a boat around; its troops come home when it is back.
 *  - A player who is eliminated loses their boats.
 *  - Ports (levels I–II): faster boats launched within their range, more boats at once,
 *    and at level II Marines (landings pay less per tile).
 *
 * Everything static about the sea (which sea a water tile belongs to) is derived from the
 * map once and cached; the pathfinder's scratch arrays are cached per map too. Neither is
 * game state.
 */
import { distanceSq } from "../geometry.ts";
import { isCoast, isLand, isValidTile, Terrain, type GameMap } from "../map/gameMap.ts";
import type { BuildingLevelRules, GameRules } from "../rules.ts";
import {
  getPlayer,
  NEUTRAL,
  sameTeam,
  type Boat,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import { launchBeachhead, updateFieldTroops } from "./attacks.ts";
import { isAllied } from "./diplomacy.ts";
import { isSpawnProtected } from "./spawn.ts";
import { TileQueue } from "./tileQueue.ts";

/** Water bodies: each water tile's sea (1, 2 …; 0 on land). Static, derived from the map. */
interface Seas {
  readonly body: Int32Array;
}

const seasCache = new WeakMap<GameMap, Seas>();

/** The map's seas (4-connected water bodies), computed once per map. */
export function seasOf(map: GameMap): Seas {
  const cached = seasCache.get(map);
  if (cached) return cached;
  const { width, terrain } = map;
  const body = new Int32Array(terrain.length);
  const queue = new Int32Array(terrain.length);
  let next = 0;
  for (let start = 0; start < terrain.length; start++) {
    if (terrain[start] !== Terrain.Water || body[start] !== 0) continue;
    const id = ++next;
    let head = 0;
    let tail = 0;
    body[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const tile = queue[head++]!;
      const x = tile % width;
      const visit = (n: number) => {
        if (terrain[n] === Terrain.Water && body[n] === 0) {
          body[n] = id;
          queue[tail++] = n;
        }
      };
      if (tile >= width) visit(tile - width);
      if (tile + width < terrain.length) visit(tile + width);
      if (x > 0) visit(tile - 1);
      if (x < width - 1) visit(tile + 1);
    }
  }
  const seas = { body };
  seasCache.set(map, seas);
  return seas;
}

const landmassCache = new WeakMap<GameMap, Int32Array>();

/** Each land tile's landmass (1, 2 …; 0 on water), 4-connected. Static, computed once per map. */
export function landmassesOf(map: GameMap): Int32Array {
  let labels = landmassCache.get(map);
  if (labels) return labels;
  const { width, terrain } = map;
  labels = new Int32Array(terrain.length);
  const queue = new Int32Array(terrain.length);
  let next = 0;
  for (let start = 0; start < terrain.length; start++) {
    if (terrain[start] === Terrain.Water || labels[start] !== 0) continue;
    const id = ++next;
    let head = 0;
    let tail = 0;
    labels[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const tile = queue[head++]!;
      const x = tile % width;
      for (const n of [
        tile - width,
        tile + width,
        x > 0 ? tile - 1 : -1,
        x < width - 1 ? tile + 1 : -1,
      ]) {
        if (n >= 0 && n < terrain.length && terrain[n] !== Terrain.Water && labels[n] === 0) {
          labels[n] = id;
          queue[tail++] = n;
        }
      }
    }
  }
  landmassCache.set(map, labels);
  return labels;
}

const coastCache = new WeakMap<GameMap, Int32Array>();

/** Every coast tile of the map, ascending (static, computed once per map). */
export function coastTiles(map: GameMap): Int32Array {
  let tiles = coastCache.get(map);
  if (!tiles) {
    const list: number[] = [];
    for (let tile = 0; tile < map.terrain.length; tile++) if (isCoast(map, tile)) list.push(tile);
    tiles = Int32Array.from(list);
    coastCache.set(map, tiles);
  }
  return tiles;
}

/** The seas next to a coast tile, as a small list (at most 4, usually 1). */
export function seasAt(map: GameMap, body: Int32Array, tile: number): number[] {
  const { width } = map;
  const x = tile % width;
  const found: number[] = [];
  const add = (n: number) => {
    const id = body[n]!;
    if (id !== 0 && !found.includes(id)) found.push(id);
  };
  if (tile >= width) add(tile - width);
  if (tile + width < body.length) add(tile + width);
  if (x > 0) add(tile - 1);
  if (x < width - 1) add(tile + 1);
  return found;
}

/** True if the coast tile touches any of `seas`. */
export function touchesSea(map: GameMap, body: Int32Array, tile: number, seas: readonly number[]) {
  for (const id of seasAt(map, body, tile)) if (seas.includes(id)) return true;
  return false;
}

/** What a player's Ports give a boat launched from `tile`: the best Port in range counts. */
interface PortEffect {
  speed: number;
  loss: number;
}

/** A Port as the boat planner sees it (a building snapshot or the live building). */
interface PortLike {
  readonly type: string;
  readonly owner: PlayerId;
  readonly tile: number;
  readonly level: number;
}

function portLevel(rules: GameRules, level: number): BuildingLevelRules | undefined {
  return level >= 1 ? rules.buildings.types.port.levels[level - 1] : undefined;
}

function portEffect(
  rules: GameRules,
  map: GameMap,
  ports: readonly PortLike[],
  tile: number,
): PortEffect {
  let speed = 1;
  let loss = 1;
  for (const port of ports) {
    const level = portLevel(rules, port.level);
    if (!level) continue;
    const range = level.range ?? 0;
    if (distanceSq(map, port.tile, tile) > range * range) continue;
    speed = Math.max(speed, level.boatSpeed ?? 1);
    loss = Math.min(loss, level.boatLoss ?? 1);
  }
  return { speed, loss };
}

/** Boats a player may have at sea at once (GAME_DESIGN.md §3.18). */
export function boatSlots(rules: GameRules, buildings: readonly PortLike[], playerId: PlayerId) {
  let slots = rules.naval.maxBoats;
  for (const b of buildings) {
    if (b.type === "port" && b.owner === playerId)
      slots += portLevel(rules, b.level)?.boatSlots ?? 0;
  }
  return Math.min(slots, rules.naval.maxBoatsWithPorts);
}

/** A boat trip as planned at launch. Shared with the HUD (route preview, ETA). */
export interface BoatPlan {
  readonly launchTile: number;
  readonly landingTile: number;
  readonly route: Int32Array;
  readonly tilesPerTick: number;
  readonly lossFactor: number;
  /** Ticks until it lands. */
  readonly ticks: number;
}

/** Why no boat can go there. */
export type BoatProblem = "noCoast" | "noOwnCoast" | "noRoute";

export const BOAT_PROBLEM_TEXT: Record<BoatProblem, string> = {
  noCoast: "no coast of theirs near there",
  noOwnCoast: "you have no coast on that sea",
  noRoute: "no sea route there",
};

/**
 * Plans a boat for `playerId` to the land around `tile` (owned by `target`, 0 = neutral).
 * `ownTiles` are the player's tiles to consider as launch points (their border tiles: every
 * coast tile is one); `buildings` are scanned for the player's Ports.
 */
export function planBoat(
  rules: GameRules,
  map: GameMap,
  owner: ArrayLike<number>,
  buildings: readonly PortLike[],
  playerId: PlayerId,
  ownTiles: Iterable<number>,
  target: PlayerId,
  tile: number,
): BoatPlan | BoatProblem {
  const { body } = seasOf(map);
  const landingTile = nearestCoast(map, owner, target, tile, rules.naval.landingSearchTiles);
  if (landingTile < 0) return "noCoast";
  const seas = seasAt(map, body, landingTile);

  // Launch from the coast that lands soonest: the nearest one, or one near a Port.
  const ports = buildings.filter((b) => b.type === "port" && b.owner === playerId && b.level >= 1);
  let launch = -1;
  let best = Infinity;
  let bestEffect: PortEffect = { speed: 1, loss: 1 };
  const consider = (candidate: number) => {
    const effect = portEffect(rules, map, ports, candidate);
    // Straight-line estimate, compared squared: (d / speed)² — no square roots needed.
    const estimate = distanceSq(map, candidate, landingTile) / (effect.speed * effect.speed);
    if (estimate < best || (estimate === best && candidate < launch)) {
      best = estimate;
      launch = candidate;
      bestEffect = effect;
    }
  };
  let nearest = -1;
  let nearestDistance = Infinity;
  for (const own of ownTiles) {
    if (owner[own] !== playerId || !isCoast(map, own) || !touchesSea(map, body, own, seas))
      continue;
    const d = distanceSq(map, own, landingTile);
    if (d < nearestDistance || (d === nearestDistance && own < nearest)) {
      nearestDistance = d;
      nearest = own;
    }
  }
  if (nearest < 0) return "noOwnCoast";
  consider(nearest);
  for (const port of ports) {
    if (owner[port.tile] === playerId && touchesSea(map, body, port.tile, seas))
      consider(port.tile);
  }

  const route = seaRoute(map, launch, landingTile, rules.naval.maxRouteNodes);
  if (!route) return "noRoute";
  const tilesPerTick = rules.naval.tilesPerTick * bestEffect.speed;
  return {
    launchTile: launch,
    landingTile,
    route,
    tilesPerTick,
    lossFactor: bestEffect.loss,
    ticks: sailTicks(route.length + 1, tilesPerTick),
  };
}

/** Whole ticks to sail `steps` route steps (at least one). */
function sailTicks(steps: number, tilesPerTick: number): number {
  return Math.max(1, Math.ceil(steps / tilesPerTick));
}

/**
 * The coast tile owned by `target` nearest `around` (ties: the lower tile index), within
 * `radius` tiles; -1 if none. Scans growing square rings, stopping once no nearer tile can
 * exist.
 */
export function nearestCoast(
  map: GameMap,
  owner: ArrayLike<number>,
  target: PlayerId,
  around: number,
  radius: number,
): number {
  const { width, height } = map;
  const cx = around % width;
  const cy = Math.floor(around / width);
  let best = -1;
  let bestDistance = Infinity;
  for (let r = 0; r <= radius; r++) {
    if (r * r > bestDistance) break;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= height) continue;
      const edge = dy === -r || dy === r;
      for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r) {
        const x = cx + dx;
        if (x >= 0 && x < width) {
          const tile = y * width + x;
          if (owner[tile] === target && isCoast(map, tile)) {
            const d = dx * dx + dy * dy;
            if (d < bestDistance || (d === bestDistance && tile < best)) {
              bestDistance = d;
              best = tile;
            }
          }
        }
        if (r === 0) break;
      }
    }
  }
  return best;
}

/** Scratch arrays for the route search, one set per map (not game state). */
interface RouteScratch {
  readonly cost: Int32Array;
  readonly parent: Int32Array;
  readonly seen: Int32Array;
  stamp: number;
}

const scratchCache = new WeakMap<GameMap, RouteScratch>();

function routeScratch(map: GameMap): RouteScratch {
  let scratch = scratchCache.get(map);
  if (!scratch) {
    const n = map.terrain.length;
    scratch = {
      cost: new Int32Array(n),
      parent: new Int32Array(n),
      seen: new Int32Array(n),
      stamp: 0,
    };
    scratchCache.set(map, scratch);
  }
  if (++scratch.stamp === 0x7fffffff) {
    scratch.seen.fill(0);
    scratch.stamp = 1;
  }
  return scratch;
}

const STRAIGHT = 10;
const DIAGONAL = 14;
/**
 * Weighted A*: the estimate counts double, so the search heads for the goal instead of
 * flooding every bay. Routes stay within 2× of the shortest (on the reference map they
 * came out the same length) and long crossings are found ~6× faster (10 ms, not 60) — it
 * runs on every launch and, in the HUD, while the mouse rests on far land.
 */
const HEURISTIC_WEIGHT = 2;

/**
 * A near-shortest sea route (weighted A*, integer costs: 10 straight, 14 diagonal) from the water next
 * to coast tile `from` to the water next to coast tile `to`; null if there is none or the
 * search visits more than `maxNodes` sea tiles. Deterministic: ties pop in insertion order.
 */
export function seaRoute(
  map: GameMap,
  from: number,
  to: number,
  maxNodes: number,
): Int32Array | null {
  const { width, terrain } = map;
  const scratch = routeScratch(map);
  const { cost, parent, seen } = scratch;
  const stamp = scratch.stamp; // seen = stamp: reached; seen = -stamp: done
  const tx = to % width;
  const ty = Math.floor(to / width);
  const estimate = (tile: number) => {
    const dx = Math.abs((tile % width) - tx);
    const dy = Math.abs(Math.floor(tile / width) - ty);
    // Octile distance to the landing tile, minus the last step onto it, weighted.
    return (
      HEURISTIC_WEIGHT *
      Math.max(0, STRAIGHT * Math.max(dx, dy) + (DIAGONAL - STRAIGHT) * Math.min(dx, dy) - STRAIGHT)
    );
  };
  const water = (tile: number) => terrain[tile] === Terrain.Water;
  const open = new TileQueue();
  const reach = (tile: number, g: number, from: number) => {
    if ((seen[tile] === stamp && cost[tile]! <= g) || seen[tile] === -stamp) return;
    seen[tile] = stamp;
    cost[tile] = g;
    parent[tile] = from;
    open.push(g + estimate(tile), tile);
  };
  const fx = from % width;
  for (const n of [from - width, from + 1, from + width, from - 1]) {
    if (n < 0 || n >= terrain.length || Math.abs((n % width) - fx) > 1) continue;
    if (water(n)) reach(n, 0, -1);
  }

  let visited = 0;
  while (open.size > 0) {
    const tile = open.pop();
    if (seen[tile] !== stamp) continue; // already done
    seen[tile] = -stamp;
    const x = tile % width;
    const y = (tile - x) / width;
    if (Math.abs(x - tx) + Math.abs(y - ty) === 1) return unwind(parent, tile);
    if (++visited > maxNodes) return null;
    const g = cost[tile]!;
    const up = y > 0 && water(tile - width);
    const down = tile + width < terrain.length && water(tile + width);
    const left = x > 0 && water(tile - 1);
    const right = x < width - 1 && water(tile + 1);
    if (up) reach(tile - width, g + STRAIGHT, tile);
    if (down) reach(tile + width, g + STRAIGHT, tile);
    if (left) reach(tile - 1, g + STRAIGHT, tile);
    if (right) reach(tile + 1, g + STRAIGHT, tile);
    // Diagonals only between two open sides: boats never cut a corner of land.
    if (up && left && water(tile - width - 1)) reach(tile - width - 1, g + DIAGONAL, tile);
    if (up && right && water(tile - width + 1)) reach(tile - width + 1, g + DIAGONAL, tile);
    if (down && left && water(tile + width - 1)) reach(tile + width - 1, g + DIAGONAL, tile);
    if (down && right && water(tile + width + 1)) reach(tile + width + 1, g + DIAGONAL, tile);
  }
  return null;
}

function unwind(parent: Int32Array, last: number): Int32Array {
  const tiles: number[] = [];
  for (let tile = last; tile >= 0; tile = parent[tile]!) tiles.push(tile);
  return Int32Array.from(tiles.reverse());
}

/**
 * How far along its route a boat is at `tick`, in route steps (0 = just left the launch
 * coast; route.length + 1 = landed). Recalled boats sail back the way they came.
 */
export function boatProgress(boat: Boat, tick: number): number {
  const steps = boat.route.length + 1;
  if (boat.recallTick < 0) return Math.min(steps, (tick - boat.launchTick) * boat.tilesPerTick);
  const turned = Math.min(steps, (boat.recallTick - boat.launchTick) * boat.tilesPerTick);
  return Math.max(0, turned - (tick - boat.recallTick) * boat.tilesPerTick);
}

/** Can `player` send troops against `target`'s land at all (not a friend, not protected)? */
function hostileTarget(world: World, player: Player, target: PlayerId): string | null {
  if (target === NEUTRAL) return null;
  if (target === player.id) return "that's your own land";
  if (!getPlayer(world, target)?.alive) return "that player is gone";
  if (isSpawnProtected(world)) return "spawn protection is still on";
  if (sameTeam(world, player.id, target)) return "they're your teammate";
  if (isAllied(world, player.id, target)) return "you're allied with them";
  return null;
}

/** Handles `boat`. Returns a rejection reason, or null on success. */
export function applyBoatCommand(
  world: World,
  player: Player,
  target: PlayerId,
  tile: number,
  percentBp: number,
): string | null {
  const { map, rules } = world;
  if (!rules.naval.enabled) return "there are no boats in this game";
  if (world.phase !== "playing") return "the match hasn't started";
  if (!Number.isInteger(percentBp) || percentBp < 1 || percentBp > 10_000)
    return "invalid percentage";
  if (!isValidTile(map, tile) || !isLand(map, tile)) return "not a land tile";
  if (!Number.isInteger(target) || target < 0 || target > world.players.length)
    return "unknown target";
  if (world.owner[tile] !== target) return "that land changed hands";
  const hostile = hostileTarget(world, player, target);
  if (hostile) return hostile;
  const atSea = world.boats.reduce((n, b) => n + (b.owner === player.id ? 1 : 0), 0);
  if (atSea >= boatSlots(rules, world.buildings, player.id)) return "all your boats are at sea";
  const troops = Math.floor((player.homeTroops * percentBp) / 10_000);
  if (troops < 1) return "not enough troops";
  const plan = planBoat(
    rules,
    map,
    world.owner,
    world.buildings,
    player.id,
    player.border,
    target,
    tile,
  );
  if (typeof plan === "string") return BOAT_PROBLEM_TEXT[plan];

  player.homeTroops -= troops;
  const boat: Boat = {
    id: world.nextBoatId++,
    owner: player.id,
    target,
    troops,
    launchTile: plan.launchTile,
    landingTile: plan.landingTile,
    focusTile: tile,
    route: plan.route,
    launchTick: world.tick,
    tilesPerTick: plan.tilesPerTick,
    lossFactor: plan.lossFactor,
    arriveTick: world.tick + plan.ticks,
    recallTick: -1,
  };
  world.boats.push(boat);
  updateFieldTroops(world);
  world.events.push({
    type: "boatLaunched",
    boatId: boat.id,
    owner: player.id,
    target,
    troops,
    landingTile: plan.landingTile,
    arriveTick: boat.arriveTick,
  });
  return null;
}

/** Handles `recallBoat`. */
export function applyRecallBoat(world: World, player: Player, boatId: number): string | null {
  const boat = world.boats.find((b) => b.id === boatId);
  if (!boat || boat.owner !== player.id) return "no such boat";
  if (boat.recallTick >= 0) return "already sailing home";
  boat.recallTick = world.tick;
  const back = boatProgress(boat, world.tick);
  boat.arriveTick = world.tick + Math.max(1, Math.ceil(back / boat.tilesPerTick));
  world.events.push({
    type: "boatRecalled",
    boatId,
    owner: player.id,
    arriveTick: boat.arriveTick,
  });
  return null;
}

/**
 * Tick system (step 2b, before the fronts advance): boats that arrive land — as a
 * beachhead attack, or home if the landing tile is now theirs or a friend's — and
 * recalled boats that are back unload.
 */
export function advanceBoats(world: World): void {
  if (world.boats.length === 0) return;
  let changed = false;
  for (const boat of world.boats) {
    if (world.tick < boat.arriveTick) continue;
    changed = true;
    const player = getPlayer(world, boat.owner)!;
    if (boat.recallTick >= 0) {
      player.homeTroops += boat.troops;
      world.events.push({
        type: "boatReturned",
        boatId: boat.id,
        owner: boat.owner,
        troops: boat.troops,
      });
      continue;
    }
    land(world, boat, player);
  }
  if (changed) {
    world.boats = world.boats.filter((b) => world.tick < b.arriveTick);
    updateFieldTroops(world);
  }
}

function land(world: World, boat: Boat, player: Player): void {
  const tile = boat.landingTile;
  const holder = world.owner[tile]!;
  let attackId = -1;
  if (holder !== player.id && hostileTarget(world, player, holder) === null) {
    const attack = launchBeachhead(
      world,
      player,
      holder,
      tile,
      boat.focusTile,
      boat.troops,
      boat.lossFactor,
    );
    attackId = attack.id;
  } else {
    player.homeTroops += boat.troops; // our own or a friend's land now: nothing to fight
  }
  world.events.push({
    type: "boatLanded",
    boatId: boat.id,
    owner: boat.owner,
    target: holder,
    tile,
    troops: boat.troops,
    attackId,
  });
}

/** A player is out: their boats sink with everyone aboard. */
export function sinkBoatsOf(world: World, playerId: PlayerId): void {
  if (!world.boats.some((b) => b.owner === playerId)) return;
  for (const boat of world.boats) {
    if (boat.owner === playerId) {
      world.events.push({ type: "boatReturned", boatId: boat.id, owner: playerId, troops: 0 });
    }
  }
  world.boats = world.boats.filter((b) => b.owner !== playerId);
  updateFieldTroops(world);
}

/** The match is over: every boat's troops go home. */
export function unloadAllBoats(world: World): void {
  for (const boat of world.boats) getPlayer(world, boat.owner)!.homeTroops += boat.troops;
  world.boats = [];
  updateFieldTroops(world);
}
