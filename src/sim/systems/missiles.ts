/**
 * Missile Silos (GAME_DESIGN.md §3.17.8, ARCHITECTURE.md §5.7, milestone 2B.5).
 *
 *  - A Silo holds `missileSlots` missiles (charges, buildings.ts `readyCharges`), each
 *    reloaded in `reloadTicks`, one at a time. `launchMissile` fires one at an enemy's tile
 *    within the Silo's range (Silo III: anywhere) and pays its gold; it flies as a flight of
 *    one "plane" at missile speed (flights.ts), visible to everyone with its ETA.
 *  - Three missiles: the **strike missile** (Silo I) — every enemy building within
 *    `missileRadius` of the target loses `missileLevels` levels (2: levels I–II are destroyed)
 *    and is out of action for a while, the target's land there is suppressed (suppression.ts,
 *    like an air strike on a point) and its owner loses `missileTroopShare` of their home
 *    troops; the **bunker buster** (Silo II) — the enemy building on the tile loses
 *    `busterLevels` levels (3: destroyed) and its owner `busterTroopShare` of their home
 *    troops; the **strategic warhead** (Silo III, its own cooldown on mission
 *    slot 0) — everyone's land within `warheadRadius` of the target except the launcher's and
 *    their teammates' becomes neutral **scorched** land: its buildings are destroyed, each
 *    owner loses home troops in proportion to the share of their land lost, and expanding into
 *    it costs `scorchedCost`× for `scorchedTicks`. A warhead that hits an ally's land breaks
 *    the alliance (the launcher is the traitor).
 *  - Interception (flights.ts): SAM II+ shoot down conventional missiles, only SAM III the
 *    warhead — one interceptor, one missile. Fortress Wall flak doesn't touch missiles.
 *  - Factory III's war production (buildings.ts `producedTicks`) shortens the reloads and the
 *    warhead's cooldown.
 *
 * "Enemy" here is what the air strike uses: a living player who isn't the launcher or a
 * friend of theirs. Buildings and land that became the launcher's or a friend's meanwhile are
 * spared (the warhead's blast spares only the launcher's and teammates' land: allies are hit).
 */
import { withinRange } from "../geometry.ts";
import { isLand, type GameMap } from "../map/gameMap.ts";
import type { GameRules } from "../rules.ts";
import {
  getPlayer,
  NEUTRAL,
  sameTeam,
  setOwner,
  type Building,
  type Flight,
  type FlightKind,
  type MissileKind,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import {
  buildingsEnabled,
  findBuilding,
  levelRules,
  producedTicks,
  readyCharges,
  spendCharge,
  startCooldown,
  strikeBuilding,
  working,
} from "./buildings.ts";
import { applyAllianceBreak, areFriendly, isAllied } from "./diplomacy.ts";
import { launchFlight } from "./flights.ts";
import { hostileTarget } from "./naval.ts";
import { suppress } from "./suppression.ts";

export const MISSILE_KINDS: readonly MissileKind[] = ["missile", "buster", "warhead"];

/** The strategic warhead's own cooldown slot on a Silo III. */
export const WARHEAD_SLOT = 0;

/** True for the flights that are missiles. */
export function isMissile(kind: FlightKind): kind is MissileKind {
  return kind === "missile" || kind === "buster" || kind === "warhead";
}

/** The Silo level that fires a kind of missile: strike missile I, bunker buster II, warhead III. */
export function missileLevel(kind: MissileKind): number {
  return kind === "missile" ? 1 : kind === "buster" ? 2 : 3;
}

/** Gold a launch of `kind` costs. */
export function missileCost(rules: GameRules, kind: MissileKind): number {
  return kind === "warhead" ? rules.flights.warheadCost : rules.flights.missileCost;
}

/** Whether a SAM of `level` can shoot down a missile of `kind` (II+: conventional, III: all). */
export function samStops(rules: GameRules, level: number, kind: MissileKind): boolean {
  if (level < 1) return false;
  const sam = levelRules(rules, "sam", level);
  return kind === "warhead" ? sam.interceptsWarheads === true : sam.interceptsMissiles === true;
}

/** A Silo as the launch rules see it (a building or its frame snapshot). */
export interface SiloLike {
  readonly type: string;
  readonly level: number;
  readonly tile: number;
  readonly reloads: readonly number[];
  readonly cooldowns: readonly number[];
  readonly disabledUntil: number;
}

/** A Silo's range in tiles at its working level (Infinity: the whole map; 0 while built). */
export function siloRange(rules: GameRules, silo: { readonly level: number }): number {
  if (silo.level < 1) return 0;
  const level = levelRules(rules, "silo", silo.level);
  return level.wholeMap ? Infinity : (level.range ?? 0);
}

/** Missiles a Silo of `level` holds (0 while first being built). */
export function siloSlots(rules: GameRules, level: number): number {
  return level >= 1 ? (levelRules(rules, "silo", level).missileSlots ?? 0) : 0;
}

/** Missiles a Silo has ready at `tick` (none while it is out of action). */
export function siloReady(rules: GameRules, silo: SiloLike, tick: number): number {
  if (!working(silo, tick)) return 0;
  return readyCharges(silo, siloSlots(rules, silo.level), tick);
}

/** Ticks until a Silo III can fire its warhead again (0 = ready). */
export function warheadCooldownLeft(silo: SiloLike, tick: number): number {
  return Math.max(0, (silo.cooldowns[WARHEAD_SLOT] ?? -1) - tick);
}

/** Why a missile can't be fired now, or null. Shared with the HUD and the nations. */
export type MissileProblem =
  | "notReady"
  | "disabled"
  | "cooldown"
  | "reloading"
  | "notHostile"
  | "noBuilding"
  | "outOfRange"
  | "gold";

export const MISSILE_LEVEL_TEXT: Record<MissileKind, string> = {
  missile: "a strike missile needs a Missile Silo",
  buster: "a bunker buster needs an Advanced Silo (level II)",
  warhead: "the strategic warhead needs a Strategic Missile Complex (level III)",
};

export const MISSILE_PROBLEM_TEXT: Record<Exclude<MissileProblem, "notReady">, string> = {
  disabled: "the Silo was hit and is out of action",
  cooldown: "the warhead is still on cooldown",
  reloading: "no missile ready — the Silo is reloading",
  notHostile: "missiles hit an enemy's land or buildings",
  noBuilding: "a bunker buster needs an enemy building to hit",
  outOfRange: "out of the Silo's range",
  gold: "not enough gold",
};

export function missileProblemText(problem: MissileProblem, kind: MissileKind): string {
  return problem === "notReady" ? MISSILE_LEVEL_TEXT[kind] : MISSILE_PROBLEM_TEXT[problem];
}

/**
 * Whether `silo` may fire a missile of `kind` at `tile` at `tick`: `hostile` says whether the
 * tile belongs to a living player who isn't the owner or a friend of theirs, `building`
 * whether such a player's building stands on it (a bunker buster needs one), `gold` what the
 * owner has.
 */
export function missileProblem(
  rules: GameRules,
  map: GameMap,
  silo: SiloLike,
  tick: number,
  tile: number,
  kind: MissileKind,
  hostile: boolean,
  building: boolean,
  gold: number,
): MissileProblem | null {
  if (silo.type !== "silo" || silo.level < missileLevel(kind)) return "notReady";
  if (!working(silo, tick)) return "disabled";
  if (kind === "warhead" && warheadCooldownLeft(silo, tick) > 0) return "cooldown";
  if (siloReady(rules, silo, tick) < 1) return "reloading";
  if (!hostile) return "notHostile";
  if (kind === "buster" && !building) return "noBuilding";
  if (!withinRange(map, silo.tile, tile, siloRange(rules, silo))) return "outOfRange";
  if (gold < missileCost(rules, kind)) return "gold";
  return null;
}

/** True when `id` is a living player who isn't `owner` or a friend of theirs. */
function isEnemy(world: World, owner: PlayerId, id: PlayerId): boolean {
  return (
    id !== NEUTRAL &&
    id !== owner &&
    getPlayer(world, id)?.alive === true &&
    !areFriendly(world, owner, id)
  );
}

/** The enemy building (of `owner`) standing on `tile`, if any. */
export function enemyBuildingAt(world: World, owner: PlayerId, tile: number): Building | undefined {
  const b = findBuilding(world, world.buildingAt[tile]!);
  return b && isEnemy(world, owner, b.owner) ? b : undefined;
}

/** Handles `launchMissile` (GAME_DESIGN.md §3.17.8, 2B.5). */
export function applyLaunchMissile(
  world: World,
  player: Player,
  buildingId: number,
  tile: number,
  kind: MissileKind,
): string | null {
  const rules = world.rules;
  if (!rules.flights.enabled || !buildingsEnabled(rules)) {
    return "there are no missiles in this game";
  }
  if (world.phase !== "playing") return "the match hasn't started";
  if (!MISSILE_KINDS.includes(kind)) return "unknown missile";
  const silo = findBuilding(world, buildingId);
  if (!silo || silo.owner !== player.id || silo.type !== "silo") return "not your Missile Silo";
  if (!Number.isInteger(tile) || tile < 0 || tile >= world.owner.length) return "invalid tile";
  const holder = world.owner[tile]!;
  const why = holder === NEUTRAL ? null : hostileTarget(world, player, holder);
  if (why) return why;
  const problem = missileProblem(
    rules,
    world.map,
    silo,
    world.tick,
    tile,
    kind,
    holder !== NEUTRAL,
    enemyBuildingAt(world, player.id, tile) !== undefined,
    player.gold,
  );
  if (problem) return missileProblemText(problem, kind);
  player.gold -= missileCost(rules, kind);
  launchFlight(world, {
    owner: player.id,
    kind,
    source: silo.id,
    fromTile: silo.tile,
    toTile: tile,
    plane: "missile",
    planes: 1,
    troops: 0,
  });
  const level = levelRules(rules, "silo", silo.level);
  spendCharge(silo, world.tick, producedTicks(world, silo, level.reloadTicks ?? 0));
  if (kind === "warhead") {
    startCooldown(
      silo,
      WARHEAD_SLOT,
      world.tick,
      producedTicks(world, silo, level.warheadCooldownTicks ?? 0),
    );
  }
  return null;
}

/** A missile over its target (called by flights.ts when it arrives). */
export function landMissile(world: World, flight: Flight): void {
  if (flight.kind === "warhead") detonateWarhead(world, flight);
  else if (flight.kind === "missile") landStrikeMissile(world, flight);
  else if (flight.kind === "buster") landBuster(world, flight);
}

/** Strike missile: enemy buildings nearby lose two levels; the land is suppressed; troops die. */
function landStrikeMissile(world: World, flight: Flight): void {
  const f = world.rules.flights;
  const hit = world.buildings.filter(
    (b) =>
      isEnemy(world, flight.owner, b.owner) &&
      withinRange(world.map, flight.toTile, b.tile, f.missileRadius),
  );
  for (const b of hit)
    strikeBuilding(world, b, f.missileLevels, f.missileDisableTicks, flight.owner);
  const holder = world.owner[flight.toTile]!;
  const victim = isEnemy(world, flight.owner, holder) ? holder : NEUTRAL;
  const troops = killTroops(world, victim, f.missileTroopShare, flight.owner);
  if (victim !== NEUTRAL) {
    suppress(
      world,
      flight.id,
      flight.owner,
      victim,
      flight.toTile,
      f.missileRadius,
      f.missileSuppressionTicks,
    );
  }
  world.events.push({
    type: "missileHit",
    flightId: flight.id,
    owner: flight.owner,
    missile: "missile",
    tile: flight.toTile,
    victim,
    buildings: hit.length,
    troops,
  });
}

/** `victim` (an enemy; NEUTRAL = nobody) loses `share` of their home troops. Returns how many. */
function killTroops(world: World, victim: PlayerId, share: number, by: PlayerId): number {
  const player = victim === NEUTRAL ? undefined : getPlayer(world, victim);
  if (!player || share <= 0) return 0;
  const troops = player.homeTroops * share;
  player.homeTroops -= troops;
  player.lastLostTo = by;
  return troops;
}

/** Bunker buster: the enemy building on the tile is destroyed (three levels); troops die. */
function landBuster(world: World, flight: Flight): void {
  const f = world.rules.flights;
  const b = enemyBuildingAt(world, flight.owner, flight.toTile);
  const holder = world.owner[flight.toTile]!;
  const victim = b ? b.owner : isEnemy(world, flight.owner, holder) ? holder : NEUTRAL;
  if (b) strikeBuilding(world, b, f.busterLevels, f.missileDisableTicks, flight.owner);
  const troops = killTroops(world, victim, f.busterTroopShare, flight.owner);
  world.events.push({
    type: "missileHit",
    flightId: flight.id,
    owner: flight.owner,
    missile: "buster",
    tile: flight.toTile,
    victim,
    buildings: b ? 1 : 0,
    troops,
  });
}

/** Whose land a warhead from `launcher` spares: their own and their teammates'. */
function spared(world: World, launcher: PlayerId, id: PlayerId): boolean {
  return id === NEUTRAL || id === launcher || sameTeam(world, launcher, id);
}

/**
 * The land tiles a warhead from `launcher` at `center` would scorch (see the header), in
 * ascending order. Shared with the HUD's aiming preview and the nations.
 */
export function warheadTiles(world: World, launcher: PlayerId, center: number): number[] {
  const { map } = world;
  const r = world.rules.flights.warheadRadius;
  const x0 = center % map.width;
  const y0 = (center - x0) / map.width;
  const tiles: number[] = [];
  for (let y = Math.max(0, y0 - r); y <= Math.min(map.height - 1, y0 + r); y++) {
    for (let x = Math.max(0, x0 - r); x <= Math.min(map.width - 1, x0 + r); x++) {
      const dx = x - x0;
      const dy = y - y0;
      if (dx * dx + dy * dy > r * r) continue;
      const tile = y * map.width + x;
      if (isLand(map, tile) && !spared(world, launcher, world.owner[tile]!)) tiles.push(tile);
    }
  }
  return tiles;
}

/** The strategic warhead: scorched land, buildings destroyed, home troops lost. */
function detonateWarhead(world: World, flight: Flight): void {
  const f = world.rules.flights;
  const launcher = flight.owner;
  const tiles = warheadTiles(world, launcher, flight.toTile);
  // Who loses what, by ascending id.
  const lost = new Map<PlayerId, number>();
  for (const tile of tiles) {
    const id = world.owner[tile]!;
    lost.set(id, (lost.get(id) ?? 0) + 1);
  }
  const ids = [...lost.keys()].sort((a, b) => a - b);
  const tilesBefore = new Map(ids.map((id) => [id, getPlayer(world, id)!.tiles]));
  // Buildings on the scorched land are destroyed (before the land changes hands, so they are
  // "struck" by the launcher rather than captured by nobody).
  const doomed = world.buildings.filter(
    (b) =>
      withinRange(world.map, flight.toTile, b.tile, f.warheadRadius) &&
      !spared(world, launcher, world.owner[b.tile]!),
  );
  for (const b of doomed) strikeBuilding(world, b, b.level + 1, 0, launcher);
  for (const tile of tiles) setOwner(world, tile, NEUTRAL);
  const victims = ids.map((id) => {
    const player = getPlayer(world, id)!;
    const before = tilesBefore.get(id)!;
    const share = before > 0 ? lost.get(id)! / before : 1;
    const troops = player.homeTroops * share;
    player.homeTroops -= troops;
    player.lastLostTo = launcher;
    return { id, tiles: lost.get(id)!, troops };
  });
  const untilTick = world.tick + f.scorchedTicks;
  world.scorched.push({ tile: flight.toTile, radius: f.warheadRadius, by: launcher, untilTick });
  world.events.push({
    type: "warheadDetonated",
    flightId: flight.id,
    owner: launcher,
    tile: flight.toTile,
    radius: f.warheadRadius,
    tiles: tiles.length,
    buildings: doomed.length,
    victims,
    untilTick,
  });
  // Striking an ally ends the alliance — the launcher broke it.
  const attacker = getPlayer(world, launcher)!;
  for (const id of ids) {
    if (isAllied(world, launcher, id)) applyAllianceBreak(world, attacker, id);
  }
}

/** The expansion cost factor of neutral `tile`: scorchedCost on scorched land, else 1. */
export function scorchedFactor(world: World, tile: number): number {
  const zones = world.scorched;
  if (zones.length === 0) return 1;
  for (const zone of zones) {
    if (withinRange(world.map, zone.tile, tile, zone.radius))
      return world.rules.flights.scorchedCost;
  }
  return 1;
}

/** Tick system part (step 2c, before the flights): scorched land whose time is up heals. */
export function expireScorched(world: World): void {
  if (world.scorched.length === 0) return;
  if (world.scorched.every((z) => z.untilTick > world.tick)) return;
  world.scorched = world.scorched.filter((z) => z.untilTick > world.tick);
}
