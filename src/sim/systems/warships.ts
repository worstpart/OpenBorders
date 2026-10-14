/**
 * Warships (GAME_DESIGN.md §3.18.1, milestone 2B.6, D-031 — the user's choices).
 *
 *  - Every Naval Base (Port III) keeps `warships` of them at sea. Nobody steers them: they
 *    patrol the sea within `patrolRange` tiles of their Base, sailing from one random point
 *    of it to the next.
 *  - They go after ships of players who are not their owner's friends (allies and teammates
 *    are safe) while those are inside the patrol area: troop boats first, then warships,
 *    then trade ships (not those bound for a Port of the owner's or a friend's: they come to
 *    trade) — the nearest of the most urgent kind. Within `gunRange` they stop and
 *    fire once every `reloadTicks`: a shell sinks a troop boat (everyone aboard is lost) or
 *    takes `shellDamage` off a warship; a trade ship is boarded instead — it sails on for the
 *    captor's nearest Port (trade.ts pays its cargo there).
 *  - A sunk warship is rebuilt at its Base after `rebuildTicks` (only while the Base works).
 *    If the Base changes hands its warships are scuttled and the new owner's are built the
 *    same way; if it is destroyed or loses its third level, they are gone.
 *  - Damaged warships mend while they have nothing to shoot at.
 *
 * A warship sails in legs (world.ts `Warship`); its position at any tick follows from its leg,
 * so the client draws it like a boat. Legs are sea routes (naval.ts `seaRoute`), planned
 * again every `repathTicks` during a chase. Patrol areas (the water a Base can reach within
 * its range) are derived from the map once per Base tile; they are not game state.
 */
import { distanceSq } from "../geometry.ts";
import { Terrain, type GameMap } from "../map/gameMap.ts";
import {
  getPlayer,
  type Boat,
  type Building,
  type PlayerId,
  type TradeShip,
  type Warship,
  type World,
} from "../world.ts";
import { updateFieldTroops } from "./attacks.ts";
import { findBuilding, levelRules, warshipsEnabled, working } from "./buildings.ts";
import { areFriendly } from "./diplomacy.ts";
import { boatProgress, seaRoute, seasAt, seasOf, touchesSea } from "./naval.ts";
import { isSpawnProtected } from "./spawn.ts";

/** The Port level that is a Naval Base. */
export const NAVAL_BASE_LEVEL = 3;

/** A leg (or a fixed voyage) as the position helpers see it. */
interface Leg {
  readonly fromTile: number;
  readonly route: Int32Array;
  readonly toTile: number;
  readonly legTick: number;
}

/** Route steps sailed along a leg at `tick` (0 = at `fromTile`; route.length + 1 = arrived). */
export function legSteps(leg: Leg, tilesPerTick: number, tick: number): number {
  return Math.min(leg.route.length + 1, Math.max(0, tick - leg.legTick) * tilesPerTick);
}

/** The tile a warship is on at `tick`. */
export function warshipTile(leg: Leg, tilesPerTick: number, tick: number): number {
  const k = Math.floor(legSteps(leg, tilesPerTick, tick));
  if (k <= 0) return leg.fromTile;
  if (k > leg.route.length) return leg.toTile;
  return leg.route[k - 1]!;
}

/** The tile a boat is on now (its launch coast, a sea tile, or its landing coast). */
function boatTile(boat: Boat, tick: number): number {
  const k = Math.floor(boatProgress(boat, tick));
  if (k <= 0) return boat.launchTile;
  if (k > boat.route.length) return boat.landingTile;
  return boat.route[k - 1]!;
}

/** The tile a trade ship is on now. */
export function tradeShipTile(ship: TradeShip, tick: number): number {
  const steps = Math.min(
    ship.route.length + 1,
    Math.max(0, tick - ship.launchTick) * ship.tilesPerTick,
  );
  const k = Math.floor(steps);
  if (k <= 0) return ship.launchTile;
  if (k > ship.route.length) return ship.landingTile;
  return ship.route[k - 1]!;
}

/** Is `building` a Naval Base (any Port whose level brings warships)? */
export function isNavalBase(
  world: World,
  building: { readonly type: string; readonly level: number },
): boolean {
  return building.type === "port" && building.level >= NAVAL_BASE_LEVEL;
}

/** Warships a Port at `level` keeps, and the radius they patrol. */
export function fleetOf(world: World, level: number): { ships: number; patrol: number } {
  if (level < 1 || !warshipsEnabled(world.rules)) return { ships: 0, patrol: 0 };
  const effect = levelRules(world.rules, "port", level);
  return { ships: effect.warships ?? 0, patrol: effect.patrolRange ?? 0 };
}

/** The water tile next to a Port where its warships put to sea (the lowest index). */
export function dockTile(map: GameMap, portTile: number): number {
  const { width, terrain } = map;
  const x = portTile % width;
  let best = -1;
  const consider = (n: number) => {
    if (terrain[n] === Terrain.Water && (best < 0 || n < best)) best = n;
  };
  if (portTile >= width) consider(portTile - width);
  if (portTile + width < terrain.length) consider(portTile + width);
  if (x > 0) consider(portTile - 1);
  if (x < width - 1) consider(portTile + 1);
  return best;
}

/** Patrol areas by map, then by "tile:range": the water of the Port's seas within range. */
const patrolCache = new WeakMap<GameMap, Map<string, Int32Array>>();

/** The sea tiles a Naval Base at `portTile` patrols (ascending; static per map). */
export function patrolTiles(map: GameMap, portTile: number, range: number): Int32Array {
  let byBase = patrolCache.get(map);
  if (!byBase) {
    byBase = new Map();
    patrolCache.set(map, byBase);
  }
  const key = `${portTile}:${range}`;
  let tiles = byBase.get(key);
  if (tiles) return tiles;
  const { body } = seasOf(map);
  const seas = seasAt(map, body, portTile);
  const { width, height } = map;
  const cx = portTile % width;
  const cy = Math.floor(portTile / width);
  const list: number[] = [];
  for (let y = Math.max(0, cy - range); y <= Math.min(height - 1, cy + range); y++) {
    for (let x = Math.max(0, cx - range); x <= Math.min(width - 1, cx + range); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > range * range) continue;
      const tile = y * width + x;
      if (body[tile]! !== 0 && seas.includes(body[tile]!)) list.push(tile);
    }
  }
  tiles = Int32Array.from(list);
  byBase.set(key, tiles);
  return tiles;
}

/**
 * Waters guarded against `playerId`: around each Naval Base of a non-friend with a warship
 * at sea, the patrol area plus a gun range (circle centre and squared radius). The nations
 * keep their boats out of them (ai/bot.ts).
 */
export function guardedWaters(
  world: World,
  playerId: PlayerId,
): { readonly tile: number; readonly rangeSq: number }[] {
  const guarded: { tile: number; rangeSq: number }[] = [];
  if (world.warships.length === 0) return guarded;
  const gun = world.rules.warships.gunRange;
  for (const ship of world.warships) {
    if (ship.readyTick >= 0 || ship.owner === playerId) continue;
    if (areFriendly(world, ship.owner, playerId)) continue;
    const base = findBuilding(world, ship.base);
    if (!base || guarded.some((g) => g.tile === base.tile)) continue;
    const r = fleetOf(world, base.level).patrol + gun;
    guarded.push({ tile: base.tile, rangeSq: r * r });
  }
  return guarded;
}

/** Something a warship can go after this tick. */
interface Prey {
  readonly kind: "boat" | "warship" | "trade";
  readonly id: number;
  readonly owner: PlayerId;
  readonly tile: number;
  /** Lower goes first: troop boats, warships, trade ships. */
  readonly rank: number;
  /** Trade ships: who owns the Port it sails for (0 = gone); else 0. */
  readonly bound: PlayerId;
}

/**
 * Tick system (step 2a, before boats land): fleets are kept up, then every warship at sea
 * picks its prey, sails and fires.
 */
export function advanceWarships(world: World): void {
  if (!warshipsEnabled(world.rules)) return;
  let bases: Building[] | null = null;
  for (const b of world.buildings) {
    if (isNavalBase(world, b)) (bases ??= []).push(b);
  }
  if (!bases && world.warships.length === 0) return;
  keepFleets(world, bases ?? []);
  if (!world.warships.some((s) => s.readyTick < 0)) return;

  const rules = world.rules.warships;
  const tick = world.tick;
  const prey = isSpawnProtected(world) ? [] : seaTargets(world);
  const gunSq = rules.gunRange * rules.gunRange;
  for (const ship of world.warships) {
    if (ship.readyTick >= 0) continue; // in the shipyard (perhaps sunk earlier this tick)
    const base = findBuilding(world, ship.base)!;
    const patrol = fleetOf(world, base.level).patrol;
    const here = warshipTile(ship, rules.tilesPerTick, tick);
    const target = choosePrey(world, ship, base.tile, patrol, here, prey);
    if (!target) {
      ship.targetKind = "";
      ship.targetId = 0;
      ship.hp = Math.min(rules.hp, ship.hp + rules.repairPerTick);
      if (legSteps(ship, rules.tilesPerTick, tick) >= ship.route.length + 1) {
        const area = patrolTiles(world.map, base.tile, patrol);
        if (area.length > 0) sail(world, ship, here, area[world.rng.nextInt(area.length)]!);
      }
      continue;
    }
    const retarget = ship.targetKind !== target.kind || ship.targetId !== target.id;
    ship.targetKind = target.kind;
    ship.targetId = target.id;
    if (distanceSq(world.map, here, target.tile) <= gunSq) {
      if (ship.route.length > 0 || ship.fromTile !== here) holdAt(ship, here, tick);
      if (tick >= ship.reloadTick) fire(world, ship, here, target);
    } else if (
      retarget ||
      tick - ship.legTick >= rules.repathTicks ||
      legSteps(ship, rules.tilesPerTick, tick) >= ship.route.length + 1
    ) {
      sail(world, ship, here, target.tile);
    }
  }
}

/** Builds, rebuilds, hands over and scraps warships so each Naval Base has its quota. */
function keepFleets(world: World, bases: readonly Building[]): void {
  const rules = world.rules.warships;
  const tick = world.tick;
  let removed = false;
  for (const ship of world.warships) {
    const base = findBuilding(world, ship.base);
    const quota = base && isNavalBase(world, base) ? fleetOf(world, base.level).ships : 0;
    const rank = base ? rankInFleet(world, ship) : Infinity;
    if (!base || rank >= quota || !getPlayer(world, base.owner)?.alive) {
      // The Base is gone or no longer a Naval Base: its warships go with it.
      if (ship.readyTick < 0) sunk(world, ship, 0, -1);
      ship.readyTick = -2; // marked for removal
      removed = true;
      continue;
    }
    if (ship.owner !== base.owner) {
      // The Base changed hands: its crews scuttle; the new owner builds their own.
      if (ship.readyTick < 0) sunk(world, ship, 0, tick + rules.rebuildTicks);
      else ship.readyTick = Math.max(ship.readyTick, tick + rules.rebuildTicks);
      ship.owner = base.owner;
      ship.targetKind = "";
      ship.targetId = 0;
      continue;
    }
    if (ship.readyTick >= 0 && tick >= ship.readyTick && working(base, tick)) {
      launch(world, ship, base);
    }
  }
  if (removed) world.warships = world.warships.filter((s) => s.readyTick !== -2);
  for (const base of bases) {
    const quota = fleetOf(world, base.level).ships;
    let have = 0;
    for (const s of world.warships) if (s.base === base.id) have++;
    for (; have < quota; have++) {
      const ship: Warship = {
        id: world.nextWarshipId++,
        owner: base.owner,
        base: base.id,
        hp: rules.hp,
        fromTile: -1,
        route: new Int32Array(0),
        toTile: -1,
        legTick: tick,
        readyTick: tick,
        reloadTick: tick,
        targetKind: "",
        targetId: 0,
      };
      world.warships.push(ship);
      // A new Naval Base launches at once — unless it is struck (it waits).
      if (working(base, tick)) launch(world, ship, base);
    }
  }
}

/** The ship's place among its Base's warships (0 = the oldest). */
function rankInFleet(world: World, ship: Warship): number {
  let rank = 0;
  for (const s of world.warships) {
    if (s === ship) return rank;
    if (s.base === ship.base && s.readyTick !== -2) rank++;
  }
  return rank;
}

function launch(world: World, ship: Warship, base: Building): void {
  const dock = dockTile(world.map, base.tile);
  ship.readyTick = -1;
  ship.hp = world.rules.warships.hp;
  ship.reloadTick = world.tick;
  ship.targetKind = "";
  ship.targetId = 0;
  holdAt(ship, dock, world.tick);
  world.events.push({
    type: "warshipLaunched",
    warshipId: ship.id,
    owner: ship.owner,
    base: base.id,
    tile: dock,
  });
}

/** The warship goes down (`by` 0: scuttled); it is back at `readyTick` (-1: never). */
function sunk(world: World, ship: Warship, by: PlayerId, readyTick: number): void {
  const tile = warshipTile(ship, world.rules.warships.tilesPerTick, world.tick);
  ship.readyTick = readyTick < 0 ? -2 : readyTick;
  ship.targetKind = "";
  ship.targetId = 0;
  world.events.push({
    type: "warshipSunk",
    warshipId: ship.id,
    owner: ship.owner,
    by,
    tile,
    readyTick,
  });
}

function holdAt(ship: Warship, tile: number, tick: number): void {
  ship.fromTile = tile;
  ship.toTile = tile;
  ship.route = new Int32Array(0);
  ship.legTick = tick;
}

/** Starts a leg from `from` toward `to` (a sea tile, or a ship's coast tile). */
function sail(world: World, ship: Warship, from: number, to: number): void {
  if (from === to) return holdAt(ship, from, world.tick);
  const route = seaRoute(world.map, from, to, world.rules.warships.maxRouteNodes);
  if (!route || route.length === 0) return holdAt(ship, from, world.tick);
  ship.fromTile = from;
  ship.route = route;
  // Never onto land: a boat on its landing coast is chased to the water next to it.
  ship.toTile = world.map.terrain[to] === Terrain.Water ? to : route[route.length - 1]!;
  ship.legTick = world.tick;
}

/** Every ship at sea a warship might go after, in a fixed order. */
function seaTargets(world: World): Prey[] {
  const tick = world.tick;
  const prey: Prey[] = [];
  for (const boat of world.boats) {
    prey.push({
      kind: "boat",
      id: boat.id,
      owner: boat.owner,
      tile: boatTile(boat, tick),
      rank: 0,
      bound: 0,
    });
  }
  const speed = world.rules.warships.tilesPerTick;
  for (const ship of world.warships) {
    if (ship.readyTick >= 0) continue;
    prey.push({
      kind: "warship",
      id: ship.id,
      owner: ship.owner,
      tile: warshipTile(ship, speed, tick),
      rank: 1,
      bound: 0,
    });
  }
  for (const ship of world.tradeShips) {
    if (ship.captured) continue; // a prize can't be taken again
    prey.push({
      kind: "trade",
      id: ship.id,
      owner: ship.owner,
      tile: tradeShipTile(ship, tick),
      rank: 2,
      bound: findBuilding(world, ship.toPort)?.owner ?? 0,
    });
  }
  return prey;
}

/**
 * The most urgent hostile ship inside the Base's patrol area: troop boats, then warships,
 * then trade ships; the nearest of them (ties: the lower id). Null = nothing to do.
 */
function choosePrey(
  world: World,
  ship: Warship,
  baseTile: number,
  patrol: number,
  here: number,
  prey: readonly Prey[],
): Prey | null {
  const patrolSq = patrol * patrol;
  let best: Prey | null = null;
  let bestDistance = Infinity;
  for (const p of prey) {
    if (p.owner === ship.owner || areFriendly(world, ship.owner, p.owner)) continue;
    if (best && p.rank > best.rank) continue;
    if (distanceSq(world.map, baseTile, p.tile) > patrolSq) continue;
    if (p.kind === "warship" && findWarship(world, p.id)!.readyTick >= 0) continue; // sunk
    // A trade ship coming to trade with the owner or a friend sails in peace (2B.6 headless:
    // seizing one's own partners took ~180 ships a game and starved everyone's trade).
    if (p.bound !== 0 && (p.bound === ship.owner || areFriendly(world, ship.owner, p.bound)))
      continue;
    const d = distanceSq(world.map, here, p.tile);
    if (!best || p.rank < best.rank || d < bestDistance || (d === bestDistance && p.id < best.id)) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}

export function findWarship(world: World, id: number): Warship | undefined {
  for (const s of world.warships) if (s.id === id) return s;
  return undefined;
}

function fire(world: World, ship: Warship, here: number, target: Prey): void {
  const rules = world.rules.warships;
  ship.reloadTick = world.tick + rules.reloadTicks;
  let result: "sunk" | "hit" | "captured";
  if (target.kind === "boat") {
    const boat = world.boats.find((b) => b.id === target.id);
    if (!boat) return;
    world.boats = world.boats.filter((b) => b !== boat);
    updateFieldTroops(world);
    world.events.push({
      type: "boatSunk",
      boatId: boat.id,
      owner: boat.owner,
      target: boat.target,
      by: ship.owner,
      tile: target.tile,
      troops: boat.troops,
    });
    result = "sunk";
  } else if (target.kind === "warship") {
    const enemy = findWarship(world, target.id);
    if (!enemy || enemy.readyTick >= 0) return;
    enemy.hp -= rules.shellDamage;
    result = enemy.hp > 0 ? "hit" : "sunk";
    if (enemy.hp <= 0) sunk(world, enemy, ship.owner, world.tick + rules.rebuildTicks);
  } else {
    const prize = world.tradeShips.find((s) => s.id === target.id);
    if (!prize) return;
    result = capture(world, ship.owner, prize, target.tile) ? "captured" : "sunk";
  }
  world.events.push({
    type: "warshipFired",
    warshipId: ship.id,
    owner: ship.owner,
    victim: target.owner,
    from: here,
    to: target.tile,
    targetKind: target.kind,
    targetId: target.id,
    result,
  });
}

/**
 * A trade ship is boarded at `tile`: it sails on as a new ship for the captor's nearest
 * working Port on that sea, carrying its cargo. With no such Port (or no route) it is sunk
 * instead. True if it was taken.
 */
function capture(world: World, captor: PlayerId, prize: TradeShip, tile: number): boolean {
  const { map } = world;
  const { body } = seasOf(map);
  const sea = seasAt(map, body, tile);
  if (body[tile]! !== 0 && !sea.includes(body[tile]!)) sea.push(body[tile]!);
  let port: Building | null = null;
  let best = Infinity;
  for (const b of world.buildings) {
    if (b.type !== "port" || b.owner !== captor || !working(b, world.tick)) continue;
    if (!touchesSea(map, body, b.tile, sea)) continue;
    const d = distanceSq(map, tile, b.tile);
    if (d < best) {
      best = d;
      port = b;
    }
  }
  world.tradeShips = world.tradeShips.filter((s) => s !== prize);
  const route = port ? seaRoute(map, tile, port.tile, world.rules.naval.maxRouteNodes) : null;
  if (!port || !route) return false;
  const ship: TradeShip = {
    id: world.nextTradeShipId++,
    owner: captor,
    fromPort: prize.fromPort,
    toPort: port.id,
    launchTile: tile,
    landingTile: port.tile,
    route,
    launchTick: world.tick,
    tilesPerTick: prize.tilesPerTick,
    arriveTick: world.tick + Math.max(1, Math.ceil((route.length + 1) / prize.tilesPerTick)),
    gold: prize.gold,
    captured: true,
  };
  world.tradeShips.push(ship);
  world.events.push({
    type: "tradeCaptured",
    shipId: prize.id,
    newShipId: ship.id,
    from: prize.owner,
    by: captor,
    tile,
    toPort: port.id,
    gold: prize.gold,
  });
  return true;
}
