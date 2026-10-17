/**
 * What the HUD shows about flights (GAME_DESIGN.md §3.17.7, milestone 2B.0): where each
 * flight is now, what it is called, and whether it comes to hurt you. Positions come from
 * the simulation's own flightPoint, so the map shows exactly where the sim says it is.
 */
import type { BuildingSnapshot, FlightSnapshot, PlayerSnapshot } from "../../sim/frame.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import type { GameRules } from "../../sim/rules.ts";
import {
  AIRLIFT_PROBLEM_TEXT,
  ASSAULT_PROBLEM_TEXT,
  airliftProblem,
  assaultProblem,
  airliftTroops,
  airportRange,
  escortsOf,
  flightPoint,
  flightTicks,
  interceptorsOnRoute,
  STRIKE_PROBLEM_TEXT,
  strikeProblem,
  type AirliftProblem,
  type AssaultProblem,
  type StrikeProblem,
} from "../../sim/systems/flights.ts";
import { levelRules } from "../../sim/systems/buildings.ts";
import {
  isMissile,
  MISSILE_KINDS,
  missileBlast,
  missileCost,
  missileLevel,
  missileProblem,
  missileProblemText,
  siloRange,
  siloReady,
  warheadCooldownLeft,
  type MissileProblem,
} from "../../sim/systems/missiles.ts";
import type { BuildingType } from "../../sim/rules.ts";
import { NEUTRAL, type FlightKind, type MissileKind, type PlayerId } from "../../sim/world.ts";

export interface FlightInfo {
  /** Map and chip icon. */
  readonly icon: string;
  /** "test flight", later "airlift", "airborne assault" … */
  readonly name: string;
  /**
   * Whether it comes to hurt whoever it flies at (an airlift to a friend doesn't). Test
   * flights count, so the incoming warning can be checked before Airports exist.
   */
  readonly hostile: boolean;
}

export const FLIGHT_INFO: Readonly<Record<FlightKind, FlightInfo>> = {
  test: { icon: "✈", name: "test flight", hostile: true },
  airlift: { icon: "✈", name: "airlift", hostile: false },
  return: { icon: "✈", name: "return flight", hostile: false },
  assault: { icon: "🪂", name: "airborne assault", hostile: true },
  strike: { icon: "💥", name: "air strike", hostile: true },
  missile: { icon: "🚀", name: "strike missile", hostile: true },
  buster: { icon: "🎯", name: "bunker buster", hostile: true },
  warhead: { icon: "☢", name: "strategic warhead", hostile: true },
};

/**
 * An Airport's missions (GAME_DESIGN.md §3.17.7): lifts to a friend or onto an enemy, and an
 * Air Base's air strike (2B.4) — and a Missile Silo's missiles (2B.5, §3.17.8): all aimed the
 * same way.
 */
export type LiftMode = "airlift" | "assault" | "strike" | MissileKind;

/** True when `mode` is a Silo's missile rather than an Airport's mission. */
export function isMissileMode(mode: LiftMode): mode is MissileKind {
  return isMissile(mode);
}

/**
 * The map sprite of a flight: helicopters carry airborne assaults (D-028). The pack's "plane"
 * art is a fighter of each era (biplane, WW2 fighter, jet), so transports and strikes share it.
 */
export function flightSprite(
  kind: FlightKind,
): "plane" | "helicopter" | "missile" | "airToGroundMissile" | "icbm" {
  if (kind === "missile") return "missile";
  if (kind === "buster") return "airToGroundMissile";
  if (kind === "warhead") return "icbm";
  return kind === "assault" ? "helicopter" : "plane";
}

/**
 * What a missile aimed at a tile would do (2B.5): a strike missile — the enemy buildings within
 * its radius each lose two levels, troops die, and the land there is suppressed; a bunker
 * buster — the building there is destroyed and troops die; the warhead — the land it would scorch, and the allies it
 * would hit (their alliance breaks).
 */
export type MissileEffect =
  | {
      readonly kind: "missile";
      readonly buildings: number;
      readonly radius: number;
      readonly seconds: number;
      /** The crater (D-033): its radius, and the enemy land tiles it would burn. */
      readonly craterRadius: number;
      readonly craterTiles: number;
    }
  | {
      readonly kind: "buster";
      readonly buildingType: BuildingType;
      readonly level: number;
      readonly levelAfter: number;
      /** Its splash (D-033): the other enemy buildings within `radius` that lose a level. */
      readonly radius: number;
      readonly splash: number;
    }
  | {
      readonly kind: "warhead";
      readonly radius: number;
      readonly tiles: number;
      readonly allies: readonly PlayerId[];
    };

/**
 * What an air strike aimed at a tile would do (2B.4): hit the enemy building standing there
 * (−1 level when enough fighters get through — a level-I building is destroyed — and out of
 * action either way), or suppress the enemy's land around the point.
 */
export type StrikeEffect =
  | {
      readonly kind: "building";
      readonly buildingType: BuildingType;
      readonly level: number;
      /** Its level afterwards (0 = destroyed), and how long it is out of action (s). */
      readonly levelAfter: number;
      readonly disabledSeconds: number;
    }
  | { readonly kind: "point"; readonly radius: number; readonly seconds: number };

/**
 * The airlift (or airborne assault, 2B.3, or air strike, 2B.4) a click would send
 * (GAME_DESIGN.md §3.17.7): from the chosen Airport to the tile under the mouse, with the
 * troops it would carry and its flight time — or why it can't go there. The rules are the
 * simulation's own (airliftProblem / assaultProblem / strikeProblem / airliftTroops).
 */
export interface AirliftPreview {
  readonly mode: LiftMode;
  readonly airport: BuildingSnapshot;
  /** The Airport's range in tiles (the ring drawn around it). */
  readonly range: number;
  /** The tile under the mouse (null: none). */
  readonly tile: number | null;
  readonly troops: number;
  readonly seconds: number;
  readonly problem:
    AirliftProblem | AssaultProblem | StrikeProblem | MissileProblem | "noTroops" | null;
  /**
   * Planes the hostile SAMs on the route would shoot down with the interceptors they have
   * ready now (GAME_DESIGN.md §3.17.7), at most all of them, and how many planes fly — the
   * escort fighters (an Air Base's, 2B.4) are shot first and count apart.
   */
  readonly planesLost: number;
  readonly planes: number;
  readonly escorts: number;
  /** A strike: what it would do there (null: no target yet, or it can't go there). */
  readonly strike: StrikeEffect | null;
  /** A missile (2B.5): what it would do there, and its price (null / 0: not a missile). */
  readonly missile: MissileEffect | null;
  readonly cost: number;
}

/** Why a lift can't go there, in words (the two modes share some problems, not the words). */
export function liftProblemText(
  mode: LiftMode,
  problem: AirliftProblem | AssaultProblem | StrikeProblem | MissileProblem | "noTroops",
): string {
  if (problem === "noTroops") return "no troops to send";
  if (isMissileMode(mode)) return missileProblemText(problem as MissileProblem, mode);
  return mode === "assault"
    ? ASSAULT_PROBLEM_TEXT[problem as AssaultProblem]
    : mode === "strike"
      ? STRIKE_PROBLEM_TEXT[problem as StrikeProblem]
      : AIRLIFT_PROBLEM_TEXT[problem as AirliftProblem];
}

export function airliftPreview(
  rules: GameRules,
  map: GameMap,
  airport: BuildingSnapshot,
  me: PlayerSnapshot,
  owner: Uint16Array,
  friends: ReadonlySet<PlayerId>,
  tick: number,
  tile: number | null,
  percent: number,
  buildings: readonly BuildingSnapshot[] = [],
  mode: LiftMode = "airlift",
  teammates: ReadonlySet<PlayerId> = new Set(),
): AirliftPreview {
  if (isMissileMode(mode)) {
    return missilePreview(
      rules,
      map,
      airport,
      me,
      owner,
      friends,
      teammates,
      tick,
      tile,
      buildings,
      mode,
    );
  }
  const range = airportRange(rules, airport);
  const striking = mode === "strike";
  const troops = striking ? 0 : airliftTroops(rules, airport.level, me, Math.round(percent * 100));
  const f = rules.flights;
  const planes = striking ? f.strikePlanes : mode === "assault" ? f.assaultPlanes : f.airliftPlanes;
  const escorts = striking ? 0 : escortsOf(rules, airport.level);
  const none = {
    mode,
    airport,
    range,
    tile,
    troops,
    planes,
    escorts,
    strike: null,
    missile: null,
    cost: 0,
  };
  if (tile === null) return { ...none, seconds: 0, problem: null, planesLost: 0 };
  const holder = owner[tile]!;
  const hostile = holder !== NEUTRAL && isHostile(holder, me.id, friends);
  const problem = striking
    ? strikeProblem(rules, map, airport, tick, tile, hostile)
    : ((mode === "assault"
        ? assaultProblem(rules, map, airport, tick, tile, hostile)
        : airliftProblem(
            rules,
            map,
            airport,
            tick,
            tile,
            holder !== me.id && friends.has(holder),
          )) ?? (troops < 1 ? "noTroops" : null));
  const plane = striking ? "fighter" : "transport";
  const seconds = (flightTicks(rules, map, airport.tile, tile, plane) * rules.tickMs) / 1000;
  const shots = problem
    ? 0
    : interceptorsOnRoute(
        rules,
        map,
        buildings,
        (samOwner) => isHostile(samOwner, me.id, friends),
        airport.tile,
        tile,
        plane,
        tick,
      ).interceptors;
  const planesLost = Math.min(planes, Math.max(0, shots - escorts));
  return {
    ...none,
    seconds,
    problem,
    planesLost,
    strike:
      striking && !problem
        ? strikeEffect(rules, buildings, tile, holder, planes - planesLost)
        : null,
  };
}

/** A Silo's missile aimed at `tile` (see airliftPreview; the Silo stands in `airport`). */
function missilePreview(
  rules: GameRules,
  map: GameMap,
  silo: BuildingSnapshot,
  me: PlayerSnapshot,
  owner: Uint16Array,
  friends: ReadonlySet<PlayerId>,
  teammates: ReadonlySet<PlayerId>,
  tick: number,
  tile: number | null,
  buildings: readonly BuildingSnapshot[],
  kind: MissileKind,
): AirliftPreview {
  const range = siloRange(rules, silo);
  const cost = missileCost(rules, kind);
  const none = {
    mode: kind,
    airport: silo,
    range,
    tile,
    troops: 0,
    planes: 1,
    escorts: 0,
    strike: null,
    cost,
  };
  if (tile === null) return { ...none, seconds: 0, problem: null, planesLost: 0, missile: null };
  const holder = owner[tile]!;
  const hostile = holder !== NEUTRAL && isHostile(holder, me.id, friends);
  const enemy = (id: PlayerId) => id !== NEUTRAL && isHostile(id, me.id, friends);
  const target = buildings.find((b) => b.tile === tile && enemy(b.owner));
  const problem = missileProblem(
    rules,
    map,
    silo,
    tick,
    tile,
    kind,
    hostile,
    target !== undefined,
    me.gold,
  );
  const seconds = (flightTicks(rules, map, silo.tile, tile, "missile") * rules.tickMs) / 1000;
  const shots = problem
    ? 0
    : interceptorsOnRoute(
        rules,
        map,
        buildings,
        (samOwner) => isHostile(samOwner, me.id, friends),
        silo.tile,
        tile,
        "missile",
        tick,
        kind,
      ).interceptors;
  return {
    ...none,
    seconds,
    problem,
    planesLost: Math.min(1, shots),
    missile: problem
      ? null
      : missileEffect(
          rules,
          map,
          owner,
          buildings,
          tile,
          kind,
          silo.level,
          me.id,
          enemy,
          friends,
          teammates,
        ),
  };
}

/** What a missile of `kind` over `tile` would do (see MissileEffect). */
function missileEffect(
  rules: GameRules,
  map: GameMap,
  owner: Uint16Array,
  buildings: readonly BuildingSnapshot[],
  tile: number,
  kind: MissileKind,
  siloLevel: number,
  me: PlayerId,
  enemy: (id: PlayerId) => boolean,
  friends: ReadonlySet<PlayerId>,
  teammates: ReadonlySet<PlayerId>,
): MissileEffect {
  const f = rules.flights;
  const blast = missileBlast(rules, siloLevel);
  const r2 = (radius: number, b: number) => {
    const dx = (b % map.width) - (tile % map.width);
    const dy = Math.floor(b / map.width) - Math.floor(tile / map.width);
    return dx * dx + dy * dy <= radius * radius;
  };
  if (kind === "missile") {
    // Like the sim: the tiles of buildings that survive the blast (level III) don't burn.
    const standing = new Set(
      buildings.filter((b) => enemy(b.owner) && b.level > f.missileLevels).map((b) => b.tile),
    );
    let craterTiles = 0;
    const c = blast.craterRadius;
    const cx = tile % map.width;
    const cy = Math.floor(tile / map.width);
    for (let y = Math.max(0, cy - c); y <= Math.min(map.height - 1, cy + c); y++) {
      for (let x = Math.max(0, cx - c); x <= Math.min(map.width - 1, cx + c); x++) {
        const at = y * map.width + x;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= c * c && enemy(owner[at]!) && !standing.has(at)) {
          craterTiles++;
        }
      }
    }
    return {
      kind,
      buildings: buildings.filter((b) => enemy(b.owner) && r2(blast.missileRadius, b.tile)).length,
      radius: blast.missileRadius,
      seconds: (f.missileSuppressionTicks * rules.tickMs) / 1000,
      craterRadius: c,
      craterTiles,
    };
  }
  if (kind === "buster") {
    const target = buildings.find((b) => b.tile === tile && enemy(b.owner))!;
    return {
      kind,
      buildingType: target.type,
      level: target.level,
      levelAfter: Math.max(0, target.level - f.busterLevels),
      radius: blast.busterSplashRadius,
      splash: buildings.filter(
        (b) => b !== target && enemy(b.owner) && r2(blast.busterSplashRadius, b.tile),
      ).length,
    };
  }
  // The warhead spares only your own land and your teammates' (missiles.ts warheadTiles).
  const r = f.warheadRadius;
  const x0 = tile % map.width;
  const y0 = Math.floor(tile / map.width);
  let tiles = 0;
  const allies = new Set<PlayerId>();
  for (let y = Math.max(0, y0 - r); y <= Math.min(map.height - 1, y0 + r); y++) {
    for (let x = Math.max(0, x0 - r); x <= Math.min(map.width - 1, x0 + r); x++) {
      if ((x - x0) ** 2 + (y - y0) ** 2 > r * r) continue;
      const holder = owner[y * map.width + x]!;
      if (holder === NEUTRAL || holder === me || teammates.has(holder)) continue;
      tiles++;
      if (friends.has(holder)) allies.add(holder);
    }
  }
  return { kind, radius: r, tiles, allies: [...allies].sort((a, b) => a - b) };
}

/** "10%": a share as a whole percent. */
const percent = (share: number) => `${Math.round(share * 100)}%`;

/** What a strike missile from a Silo of `level` does, in a few words (cards, the aiming banner). */
export function strikeMissileText(rules: GameRules, level: number): string {
  const f = rules.flights;
  const blast = missileBlast(rules, level);
  return `blasts a ${blast.craterRadius} km crater of empty land, every enemy building within ${blast.missileRadius} km loses ${f.missileLevels} level${f.missileLevels > 1 ? "s" : ""}, and ${percent(f.missileTroopShare)} of their troops die`;
}

/** What a bunker buster from a Silo of `level` does, in a few words. */
export function busterText(rules: GameRules, level: number): string {
  const f = rules.flights;
  const blast = missileBlast(rules, level);
  const hit =
    f.busterLevels >= 3
      ? "destroys one enemy building"
      : `one building loses ${f.busterLevels} levels`;
  return `${hit}, the enemy buildings within ${blast.busterSplashRadius} km lose ${f.busterSplashLevels} level${f.busterSplashLevels > 1 ? "s" : ""}, and ${percent(f.busterTroopShare)} of its owner's troops die`;
}

/** A missile's effect in a few words, for the aiming label. */
export function missileEffectText(rules: GameRules, effect: MissileEffect): string {
  const f = rules.flights;
  if (effect.kind === "missile") {
    const crater =
      effect.craterTiles > 0
        ? `crater: ${effect.craterTiles.toLocaleString("en-US")} tiles burned · `
        : "";
    const hit =
      effect.buildings > 0
        ? `${effect.buildings} building${effect.buildings > 1 ? "s" : ""} −${f.missileLevels} levels · `
        : "";
    return `${crater}${hit}${percent(f.missileTroopShare)} of their troops · suppress ${effect.radius} km for ${effect.seconds} s`;
  }
  if (effect.kind === "buster") {
    const name = levelRules(rules, effect.buildingType, Math.max(1, effect.level)).name;
    const splash =
      effect.splash > 0
        ? ` · ${effect.splash} more building${effect.splash > 1 ? "s" : ""} −${f.busterSplashLevels}`
        : "";
    const troops = ` · ${percent(f.busterTroopShare)} of their troops`;
    return effect.levelAfter === 0
      ? `destroy ${name}${splash}${troops}`
      : `${name} → level ${ROMAN[effect.levelAfter]}${splash}${troops}`;
  }
  return `scorch ${effect.tiles.toLocaleString("en-US")} tiles of land`;
}

/** What a strike with `through` fighters arriving over `tile` would do (see StrikeEffect). */
function strikeEffect(
  rules: GameRules,
  buildings: readonly BuildingSnapshot[],
  tile: number,
  holder: PlayerId,
  through: number,
): StrikeEffect {
  const f = rules.flights;
  const target = buildings.find((b) => b.tile === tile && b.owner === holder);
  if (!target) {
    return {
      kind: "point",
      radius: f.suppressionRadius,
      seconds: (f.suppressionTicks * rules.tickMs) / 1000,
    };
  }
  const hit = through >= f.strikeDamagePlanes ? 1 : 0;
  return {
    kind: "building",
    buildingType: target.type,
    level: target.level,
    levelAfter: Math.max(0, target.level - hit),
    disabledSeconds: (f.strikeDisableTicks * rules.tickMs) / 1000,
  };
}

const ROMAN = ["", "I", "II", "III"];

/** A strike's effect in a few words, for the aiming label ("Factory → level II"). */
export function strikeEffectText(rules: GameRules, effect: StrikeEffect): string {
  if (effect.kind === "point") return `suppress ${effect.radius} km for ${effect.seconds} s`;
  const name = levelRules(rules, effect.buildingType, Math.max(1, effect.level)).name;
  if (effect.levelAfter === 0) return `destroy ${name}`;
  if (effect.levelAfter < effect.level) return `${name} → level ${ROMAN[effect.levelAfter]}`;
  return `${name} out of action ${effect.disabledSeconds} s`;
}

/** Whose SAMs shoot at our planes: everyone but us and our friends (GAME_DESIGN.md §3.17.7). */
export function isHostile(owner: PlayerId, me: PlayerId, friends: ReadonlySet<PlayerId>): boolean {
  return owner !== me && !friends.has(owner);
}

/** An interception being drawn: a SAM's shot streaking to a plane, then a puff. */
export interface ShotEffect {
  /** Where the SAM stands and where the plane was hit (tiles). */
  readonly fromTile: number;
  readonly tile: number;
  /** performance.now() when it was fired. */
  readonly start: number;
}

/** How long a shot streaks, and how long the puff after it lasts (ms). */
export const SHOT_MS = 280;
export const PUFF_MS = 900;

/** A flight's position (tile coordinates, tile centres at .5) and heading at `tick`. */
export function flightPosition(
  map: GameMap,
  flight: FlightSnapshot,
  tick: number,
): { x: number; y: number; dx: number; dy: number } {
  const p = flightPoint(map, flight, tick);
  const dx = (flight.toTile % map.width) - (flight.fromTile % map.width);
  const dy = Math.floor(flight.toTile / map.width) - Math.floor(flight.fromTile / map.width);
  return { x: p.x + 0.5, y: p.y + 0.5, dx, dy };
}

/** Seconds until a flight is over its target (fractional ticks allowed). */
export function flightSecondsLeft(flight: FlightSnapshot, tick: number, tickMs: number): number {
  return Math.max(0, ((flight.arriveTick - tick) * tickMs) / 1000);
}

/** A missile's blast being drawn (2B.5): a flash, then a ring spreading over its radius. */
export interface BlastEffect {
  readonly tile: number;
  /** Tiles. */
  readonly radius: number;
  readonly warhead: boolean;
  /** performance.now() when it hit. */
  readonly start: number;
}

/** How long a blast shows (ms). */
export const BLAST_MS = 1600;

/**
 * The missile launcher in the command bar (D-033, the user: "we should have a button once the
 * missile silo is placed to easily send missiles out fast"): one button per missile your Silos
 * can fire, with how many are ready — a click (or its key) aims it, and every click on enemy
 * land fires one from whichever Silo can reach it.
 */
export interface LauncherSlot {
  readonly kind: MissileKind;
  readonly name: string;
  readonly key: string;
  /** Missiles of this kind ready to fire now (launches sent but not yet seen count as used). */
  readonly ready: number;
  readonly cost: number;
  readonly affordable: boolean;
}

export const LAUNCHER_NAMES: Readonly<Record<MissileKind, { name: string; key: string }>> = {
  missile: { name: "Missile", key: "R" },
  buster: { name: "Buster", key: "T" },
  warhead: { name: "Warhead", key: "X" },
};

/** Your finished Silos that can fire `kind`. */
export function silosFor(
  buildings: readonly BuildingSnapshot[],
  me: PlayerId,
  kind: MissileKind,
): BuildingSnapshot[] {
  return buildings.filter(
    (b) => b.owner === me && b.type === "silo" && b.level >= missileLevel(kind),
  );
}

/** Missiles of `kind` a Silo can fire now, minus the launches already sent from it (`pending`). */
export function siloShots(
  rules: GameRules,
  silo: BuildingSnapshot,
  kind: MissileKind,
  tick: number,
  pending = 0,
): number {
  if (kind === "warhead" && (warheadCooldownLeft(silo, tick) > 0 || pending > 0)) return 0;
  const ready = Math.max(0, siloReady(rules, silo, tick) - pending);
  return kind === "warhead" ? Math.min(1, ready) : ready;
}

export function missileLauncher(
  rules: GameRules,
  buildings: readonly BuildingSnapshot[],
  me: PlayerSnapshot,
  tick: number,
  pending: ReadonlyMap<number, number> = new Map(),
): LauncherSlot[] {
  if (!rules.flights.enabled) return [];
  const slots: LauncherSlot[] = [];
  for (const kind of MISSILE_KINDS) {
    const silos = silosFor(buildings, me.id, kind);
    if (silos.length === 0) continue;
    let ready = 0;
    for (const silo of silos)
      ready += siloShots(rules, silo, kind, tick, pending.get(silo.id) ?? 0);
    const cost = missileCost(rules, kind);
    slots.push({ kind, ...LAUNCHER_NAMES[kind], ready, cost, affordable: me.gold >= cost });
  }
  return slots;
}

/**
 * A missile of `kind` aimed at `tile` from whichever of your Silos should fire it: the
 * nearest one that can (in range, a missile ready), else the nearest one that could reach,
 * to say why not. Null when you have no Silo for it.
 */
export function launcherPreview(
  rules: GameRules,
  map: GameMap,
  me: PlayerSnapshot,
  owner: Uint16Array,
  friends: ReadonlySet<PlayerId>,
  teammates: ReadonlySet<PlayerId>,
  tick: number,
  tile: number | null,
  buildings: readonly BuildingSnapshot[],
  kind: MissileKind,
  pending: ReadonlyMap<number, number> = new Map(),
): AirliftPreview | null {
  const silos = silosFor(buildings, me.id, kind);
  if (silos.length === 0) return null;
  const at = tile ?? silos[0]!.tile;
  const distance = (b: BuildingSnapshot) => {
    const dx = (b.tile % map.width) - (at % map.width);
    const dy = Math.floor(b.tile / map.width) - Math.floor(at / map.width);
    return dx * dx + dy * dy;
  };
  silos.sort((a, b) => distance(a) - distance(b) || a.id - b.id);
  let fallback: AirliftPreview | null = null;
  for (const silo of silos) {
    const preview = airliftPreview(
      rules,
      map,
      silo,
      me,
      owner,
      friends,
      tick,
      tile,
      0,
      buildings,
      kind,
      teammates,
    );
    const shots = siloShots(rules, silo, kind, tick, pending.get(silo.id) ?? 0);
    if (!preview.problem && shots > 0) return preview;
    if (!fallback || (fallback.problem === "outOfRange" && preview.problem !== "outOfRange")) {
      fallback =
        !preview.problem && shots < 1
          ? { ...preview, problem: kind === "warhead" ? "cooldown" : "reloading", missile: null }
          : preview;
    }
  }
  return fallback;
}
