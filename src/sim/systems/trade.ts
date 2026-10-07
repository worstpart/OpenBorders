/**
 * Trade ships (GAME_DESIGN.md §3.19, milestone 2.8 — the user's request).
 *
 *  - Every finished Port sends a trade ship on its own beat (Port I every 20 s, Naval Port
 *    every 10 s) to another living player's finished Port on the same sea, picked at random.
 *  - The ship sails the sea route at `rules.trade.tilesPerTick`. Like a boat, its position
 *    is a pure function of the tick; routes between two Ports are cached per map.
 *  - When it docks, both the ship's owner and the destination Port's owner earn
 *    `tradeGoldFor(route)`. If the Port has been captured meanwhile, its new owner takes the
 *    receiving half (unless that is the ship's own owner: no gold); if it is gone, the ship
 *    is lost.
 *  - A player who is eliminated loses their trade ships.
 *
 * Warships (2B.6) will capture non-allied ships by changing `owner` and `toPort`.
 */
import type { GameMap } from "../map/gameMap.ts";
import type { GameRules } from "../rules.ts";
import { getPlayer, type Building, type Player, type TradeShip, type World } from "../world.ts";
import { findBuilding, levelRules } from "./buildings.ts";
import { seaRoute, seasAt, seasOf } from "./naval.ts";

/** Trade needs gold, buildings (Ports) and boats. */
export function tradeEnabled(rules: GameRules): boolean {
  return (
    rules.trade.enabled && rules.naval.enabled && rules.buildings.enabled && rules.economy.enabled
  );
}

/** Gold each side earns for a trip over `routeTiles` sea tiles. Integer. */
export function tradeGoldFor(rules: GameRules, routeTiles: number): number {
  const t = rules.trade;
  return Math.floor(Math.min(t.goldMax, t.goldBase + t.goldPerTile * routeTiles));
}

/** How often (ticks) a Port at `level` sends a trade ship; 0 = never. */
export function tradeEveryTicks(rules: GameRules, level: number): number {
  if (level < 1) return 0;
  return levelRules(rules, "port", level).tradeEveryTicks ?? 0;
}

/** A Port as trade sees it (a building or its snapshot). */
interface PortLike {
  readonly id: number;
  readonly type: string;
  readonly owner: number;
  readonly tile: number;
  readonly level: number;
}

/**
 * Other players' finished Ports that share a sea with `port` (ascending id). `alive` says
 * whether a player can still trade.
 */
export function tradePartners<P extends PortLike>(
  map: GameMap,
  buildings: readonly P[],
  port: PortLike,
  alive: (owner: number) => boolean,
): P[] {
  const { body } = seasOf(map);
  const seas = seasAt(map, body, port.tile);
  const partners: P[] = [];
  if (seas.length === 0) return partners;
  for (const other of buildings) {
    if (other.type !== "port" || other.level < 1 || other.owner === port.owner) continue;
    if (!alive(other.owner)) continue;
    if (seasAt(map, body, other.tile).some((id) => seas.includes(id))) partners.push(other);
  }
  return partners;
}

/** Sea routes between Port tiles, per map (static: a function of the map alone). */
const routeCache = new WeakMap<GameMap, Map<number, Int32Array | null>>();

function portRoute(map: GameMap, from: number, to: number, maxNodes: number): Int32Array | null {
  let routes = routeCache.get(map);
  if (!routes) {
    routes = new Map();
    routeCache.set(map, routes);
  }
  const key = from * 0x1000000 + to;
  let route = routes.get(key);
  if (route === undefined) {
    route = seaRoute(map, from, to, maxNodes);
    routes.set(key, route);
  }
  return route;
}

/** Ports send on their own beat (spread by id), so they don't all leave at once. */
function sendsNow(tick: number, port: Building, every: number): boolean {
  return (tick + port.id * 37) % every === 0;
}

/** Tick system (in step 6b, after income): ships dock, then Ports send new ones. */
export function advanceTrade(world: World): void {
  const rules = world.rules;
  if (!tradeEnabled(rules)) return;
  if (world.tradeShips.length > 0) dockArrivals(world);

  const alive = (id: number) => getPlayer(world, id)?.alive === true;
  for (const port of world.buildings) {
    if (port.type !== "port" || port.level < 1) continue;
    const every = tradeEveryTicks(rules, port.level);
    if (every <= 0 || !sendsNow(world.tick, port, every)) continue;
    if (world.tradeShips.length >= rules.trade.maxShips) break;
    if (!alive(port.owner)) continue;
    const partners = tradePartners(world.map, world.buildings, port, alive);
    if (partners.length === 0) continue;
    const to = partners[world.rng.nextInt(partners.length)]!;
    const route = portRoute(world.map, port.tile, to.tile, rules.naval.maxRouteNodes);
    if (!route) continue;
    const tilesPerTick = rules.trade.tilesPerTick;
    world.tradeShips.push({
      id: world.nextTradeShipId++,
      owner: port.owner,
      fromPort: port.id,
      toPort: to.id,
      launchTile: port.tile,
      landingTile: to.tile,
      route,
      launchTick: world.tick,
      tilesPerTick,
      arriveTick: world.tick + Math.max(1, Math.ceil((route.length + 1) / tilesPerTick)),
      gold: tradeGoldFor(rules, route.length),
    });
  }
}

function dockArrivals(world: World): void {
  let docked = false;
  for (const ship of world.tradeShips) {
    if (world.tick < ship.arriveTick) continue;
    docked = true;
    const sender = getPlayer(world, ship.owner);
    const port = findBuilding(world, ship.toPort);
    const receiver: Player | undefined =
      port && port.level >= 1 ? getPlayer(world, port.owner) : undefined;
    // Lost: the Port is gone; or no trade: it is the sender's own Port now.
    const paid = sender?.alive && receiver?.alive && receiver !== sender;
    if (paid) {
      sender.gold += ship.gold;
      sender.tradeGold += ship.gold;
      receiver.gold += ship.gold;
      receiver.tradeGold += ship.gold;
    }
    world.events.push({
      type: "tradeDocked",
      shipId: ship.id,
      owner: ship.owner,
      receiver: paid ? receiver.id : 0,
      fromPort: ship.fromPort,
      toPort: ship.toPort,
      tile: ship.landingTile,
      gold: paid ? ship.gold : 0,
    });
  }
  if (docked) world.tradeShips = world.tradeShips.filter((s) => world.tick < s.arriveTick);
}

/** A player is out: their trade ships are lost. */
export function sinkTradeShipsOf(world: World, playerId: number): void {
  if (world.tradeShips.some((s) => s.owner === playerId)) {
    world.tradeShips = world.tradeShips.filter((s) => s.owner !== playerId);
  }
}

/**
 * Trade a nation can expect now from a Port at `tile` that sends a ship every `every` ticks
 * (gold per tick, sent and received).
 */
export function expectedTradePerTick(world: World, playerId: number, tile: number, every: number) {
  const rules = world.rules;
  if (!tradeEnabled(rules) || every <= 0 || tile < 0) return 0;
  const alive = (id: number) => getPlayer(world, id)?.alive === true;
  const probe = { id: -1, type: "port", owner: playerId, tile, level: 1 };
  const partners = tradePartners(world.map, world.buildings, probe, alive);
  if (partners.length === 0) return 0;
  // Straight-line distance stands in for the route (no searches while deciding).
  let sum = 0;
  const { width } = world.map;
  for (const p of partners) {
    const dx = (p.tile % width) - (tile % width);
    const dy = Math.floor(p.tile / width) - Math.floor(tile / width);
    sum += tradeGoldFor(rules, Math.sqrt(dx * dx + dy * dy));
  }
  // Ships sent, plus about as many received from the partners.
  return (2 * sum) / partners.length / every;
}
