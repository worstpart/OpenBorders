/**
 * Expansion into neutral land and attacks on players (GAME_DESIGN.md §3.5–3.7).
 *
 * An attack is an army aimed at one target (a player, or neutral land). Its front is a
 * queue of target tiles next to the attacker's land, each with the tick it can be taken:
 *
 *   ready = (when it reached the front) + layer delay × direction pull − fill bonus + noise
 *
 * Every tick the attack takes the ready tiles in order, paying troops for each, until
 * nothing is ready or the army can't pay. Taking a tile puts its neighbours on the front.
 * So a front advances one tile per layer delay — faster on plains, with bigger armies and
 * better odds — and a long border takes more tiles per tick only because more tiles are
 * on it. Directed attacks: border tiles nearer the click point join the front earlier.
 */
import { attackLossFactor } from "../battle.ts";
import { isLand, isValidTile, tileX, tileY } from "../map/gameMap.ts";
import { detPow } from "../math/detmath.ts";
import { terrainValue } from "../rules.ts";
import {
  getPlayer,
  isTribe,
  NEUTRAL,
  nextScratchStamp,
  sameTeam,
  setOwner,
  touchesOwner,
  type Attack,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import { isAllied, isTraitor } from "./diplomacy.ts";
import { wallBreakTroops, wallHoldTicks, wallLossFactor } from "./walls.ts";
import { isSpawnProtected } from "./spawn.ts";
import { scorchedFactor } from "./missiles.ts";
import { isSuppressed } from "./suppression.ts";
import { gradientNoise } from "../map/noise.ts";
import { TileQueue } from "./tileQueue.ts";

/** Smallest delay between a tile reaching the front and falling (at most 2 layers per tick). */
const MIN_DELAY_TICKS = 0.5;

/** Handles the `attack` command. Returns a rejection reason, or null on success. */
export function applyAttackCommand(
  world: World,
  player: Player,
  target: PlayerId,
  focusTile: number,
  percentBp: number,
): string | null {
  const { map } = world;
  if (world.phase !== "playing") return "the match hasn't started";
  if (!Number.isInteger(percentBp) || percentBp < 1 || percentBp > 10_000)
    return "invalid percentage";
  if (!isValidTile(map, focusTile) || !isLand(map, focusTile)) return "not a land tile";
  if (!Number.isInteger(target) || target < 0 || target > world.players.length)
    return "unknown target";
  if (world.owner[focusTile] !== target) return "that land changed hands";
  if (target === player.id) return "can't attack yourself";
  if (target !== NEUTRAL) {
    if (!getPlayer(world, target)!.alive) return "that player is gone";
    if (isSpawnProtected(world)) return "spawn protection is still on";
    if (sameTeam(world, player.id, target)) return "they're your teammate";
    if (isAllied(world, player.id, target)) return "you're allied with them";
  }
  const troops = Math.floor((player.homeTroops * percentBp) / 10_000);
  if (troops < 1) return "not enough troops";
  if (!bordersTarget(world, player, target)) return "you don't border that land";

  player.homeTroops -= troops;
  // Land clicks add to the land army against this target; beachheads stay separate.
  let attack = world.attacks.find(
    (a) =>
      a.attacker === player.id &&
      a.target === target &&
      a.landingTile < 0 &&
      a.retreatTick < 0 &&
      !a.ended,
  );
  if (attack) {
    attack.troops += troops;
    attack.focusTile = focusTile;
  } else {
    attack = {
      id: world.nextAttackId++,
      attacker: player.id,
      target,
      troops,
      focusTile,
      startTick: world.tick,
      tilesTaken: 0,
      retreatTick: -1,
      ended: false,
      front: new TileQueue(),
      scheduled: new Map(),
      growthSeed: world.rng.nextUint32(),
      freeRetreat: false,
      landingTile: -1,
      lossFactor: 1,
      airborne: false,
    };
    world.attacks.push(attack);
    world.events.push({
      type: "attackStarted",
      attackId: attack.id,
      attacker: player.id,
      target,
      landingTile: -1,
    });
  }
  // A (bigger) attack can make an enclosed player's main territory fall (encirclement).
  if (target !== NEUTRAL) getPlayer(world, target)!.encircleDirty = true;
  seedFront(world, attack);
  updateFieldTroops(world);
  return null;
}

/**
 * A beachhead attack (GAME_DESIGN.md §3.18): an army landing on `landingTile` (the
 * target's, or neutral land) that first takes that tile — paying for it like any tile —
 * and then spreads from it toward `focusTile`. It never merges with the land army against
 * the same target. Used by boats and by airborne assaults (`airborne`, 2B.3). Its pocket
 * can't be encircled while the attack advances (encirclement.ts).
 */
export function launchBeachhead(
  world: World,
  player: Player,
  target: PlayerId,
  landingTile: number,
  focusTile: number,
  troops: number,
  lossFactor: number,
  airborne = false,
): Attack {
  const attack: Attack = {
    id: world.nextAttackId++,
    attacker: player.id,
    target,
    troops,
    focusTile,
    startTick: world.tick,
    tilesTaken: 0,
    retreatTick: -1,
    ended: false,
    front: new TileQueue(),
    scheduled: new Map(),
    growthSeed: world.rng.nextUint32(),
    freeRetreat: false,
    landingTile,
    lossFactor,
    airborne,
  };
  world.attacks.push(attack);
  world.events.push({
    type: "attackStarted",
    attackId: attack.id,
    attacker: player.id,
    target,
    landingTile,
    airborne,
  });
  if (target !== NEUTRAL) getPlayer(world, target)!.encircleDirty = true;
  schedule(attack, landingTile, world.tick);
  updateFieldTroops(world);
  return attack;
}

/** Handles the `retreat` command: the army stops at once and comes home later, minus a penalty. */
export function applyRetreatCommand(world: World, player: Player, attackId: number): string | null {
  const attack = world.attacks.find((a) => a.id === attackId);
  if (!attack || attack.ended || attack.attacker !== player.id) return "no such attack";
  if (attack.retreatTick >= 0) return "already retreating";
  retreatAttack(world, attack, false);
  return null;
}

/**
 * Stops an attack; its army comes home after `retreatTicks`, minus the retreat penalty
 * against a player unless `free` (the two sides just became allies).
 */
export function retreatAttack(world: World, attack: Attack, free: boolean): void {
  attack.retreatTick = world.tick + world.rules.attack.retreatTicks;
  attack.freeRetreat = free;
  // A landing pocket loses its protection from encirclement: check it again.
  if (attack.landingTile >= 0) getPlayer(world, attack.attacker)!.encircleDirty = true;
  attack.front.clear();
  attack.scheduled.clear();
}

/**
 * Tick system: armies of two players attacking each other collide and cancel out first;
 * the bigger one continues with the difference. Landed armies (beachheads: boats and
 * airborne assaults) never collide — they fight on a front of their own, far from the land
 * armies, so a counter-attack must take their pocket tile by tile (user, after the 2B.4
 * playtest: a counter anywhere wiped a landed army out at once and its pocket was annexed).
 */
export function resolveCollisions(world: World): void {
  const attacks = world.attacks;
  for (let i = 0; i < attacks.length; i++) {
    const a = attacks[i]!;
    if (a.target === NEUTRAL || a.retreatTick >= 0 || a.troops <= 0) continue;
    for (let j = i + 1; j < attacks.length; j++) {
      const b = attacks[j]!;
      if (b.attacker !== a.target || b.target !== a.attacker) continue;
      if (b.retreatTick >= 0 || b.troops <= 0) continue;
      if (a.landingTile >= 0 || b.landingTile >= 0) continue;
      const clash = Math.min(a.troops, b.troops);
      a.troops -= clash;
      b.troops -= clash;
    }
  }
  for (const attack of attacks) {
    if (attack.troops <= 0 && attack.retreatTick < 0 && !attack.ended) {
      endAttack(world, attack, "cancelled");
    }
  }
  removeEnded(world);
}

/** Tick system: brings retreating armies home and advances every other front. */
export function advanceAttacks(world: World): void {
  for (const attack of world.attacks) {
    if (attack.ended) continue;
    if (attack.retreatTick >= 0) {
      if (world.tick >= attack.retreatTick) endAttack(world, attack, "retreated");
      continue;
    }
    advance(world, attack);
  }
  removeEnded(world);
  updateFieldTroops(world);
}

function advance(world: World, attack: Attack): void {
  const { map } = world;
  const attacker = getPlayer(world, attack.attacker)!;
  const front = attack.front;
  while (front.peekTime() <= world.tick) {
    const time = front.peekTime();
    const tile = front.pop();
    if (attack.scheduled.get(tile) !== time) continue; // superseded by an earlier entry
    attack.scheduled.delete(tile);
    // Stale entries: the tile changed hands, or our land next to it was lost. (A beachhead's
    // landing tile is taken from the sea.)
    if (world.owner[tile] !== attack.target) continue;
    if (!touchesOwner(world, tile, attack.attacker) && tile !== attack.landingTile) continue;

    const cost = tileCost(world, attack, tile);
    if (attack.troops < cost) {
      endAttack(world, attack, "spent");
      return;
    }
    attack.troops -= cost;
    if (attack.target !== NEUTRAL) {
      const defender = getPlayer(world, attack.target)!;
      defender.homeTroops = Math.max(0, defender.homeTroops - defenderDensity(defender));
    }
    setOwner(world, tile, attacker.id);
    attack.tilesTaken++;

    // Neighbours' times count from when this tile fell (`time`), not from the current
    // tick: fronts advance in continuous time, so whole-tick processing can't distort
    // their shape. (Several layers can fall in one tick when delays are short.)
    const width = map.width;
    const x = tile % width;
    if (tile >= width) discover(world, attack, tile - width, tile, time);
    if (tile + width < world.owner.length) discover(world, attack, tile + width, tile, time);
    if (x > 0) discover(world, attack, tile - 1, tile, time);
    if (x < width - 1) discover(world, attack, tile + 1, tile, time);
  }
  if (front.size === 0) endAttack(world, attack, "complete");
}

/**
 * Puts a target tile next to newly taken land onto the front — or, if it is already on
 * the front, makes it fall sooner now that another of its sides is ours.
 */
function discover(world: World, attack: Attack, tile: number, from: number, now: number): void {
  if (world.owner[tile] !== attack.target || !isLand(world.map, tile)) return;
  const pending = attack.scheduled.get(tile);
  if (pending === undefined) {
    schedule(attack, tile, now + stepDelay(world, attack, tile, from));
    return;
  }
  const saved = world.rules.attack.fillShare * layerDelay(world, attack, tile);
  const sooner = Math.max(now + MIN_DELAY_TICKS, pending - saved);
  if (sooner < pending) schedule(attack, tile, sooner);
}

function schedule(attack: Attack, tile: number, ready: number): void {
  attack.scheduled.set(tile, ready);
  attack.front.push(ready, tile);
}

/**
 * Puts every target tile along the attacker's border onto the front. Directed attacks:
 * tiles farther from the click point than the nearest one join later (focusSpread).
 */
function seedFront(world: World, attack: Attack): void {
  const { map } = world;
  const attacker = getPlayer(world, attack.attacker)!;
  const stamp = nextScratchStamp(world);
  const marks = world.scratchMarks;
  const seeds: number[] = [];
  const parents: number[] = [];
  for (const borderTile of attacker.border) {
    const x = tileX(map, borderTile);
    const candidates = [
      borderTile >= map.width ? borderTile - map.width : -1,
      borderTile + map.width < marks.length ? borderTile + map.width : -1,
      x > 0 ? borderTile - 1 : -1,
      x < map.width - 1 ? borderTile + 1 : -1,
    ];
    for (const tile of candidates) {
      if (tile < 0 || marks[tile] === stamp) continue;
      if (world.owner[tile] !== attack.target || !isLand(map, tile)) continue;
      marks[tile] = stamp;
      seeds.push(tile);
      parents.push(borderTile);
    }
  }
  const spread = world.rules.attack.focusSpread;
  let nearest = Infinity;
  for (const tile of seeds) nearest = Math.min(nearest, distance(world, tile, attack.focusTile));
  for (let k = 0; k < seeds.length; k++) {
    const tile = seeds[k]!;
    const lateStart = spread * (distance(world, tile, attack.focusTile) - nearest);
    const ready = world.tick + lateStart + stepDelay(world, attack, tile, parents[k]!);
    const pending = attack.scheduled.get(tile);
    if (pending === undefined || ready < pending) schedule(attack, tile, ready);
  }
}

/** Ticks between `tile` reaching the front (from `from`) and falling. */
function stepDelay(world: World, attack: Attack, tile: number, from: number): number {
  const rules = world.rules.attack;
  let delay = layerDelay(world, attack, tile);
  if (rules.focusPull > 0) {
    // −1 when this step heads straight for the click point, +1 straight away from it.
    const away = distance(world, tile, attack.focusTile) - distance(world, from, attack.focusTile);
    delay *= 1 + (rules.focusPull * (clamp(away, -1, 1) + 1)) / 2;
  }
  delay *= growthResistance(world, attack, tile);
  delay *= 1 - rules.fillShare * (ownNeighbors(world, tile, attack.attacker) - 1);
  delay *= 1 + world.rng.nextFloat() * rules.noiseShare;
  return Math.max(MIN_DELAY_TICKS, delay);
}

/** How long the front takes to advance one tile onto `tile`, before direction and fill. */
function layerDelay(world: World, attack: Attack, tile: number): number {
  const { expansion, combat } = world.rules;
  const terrain = world.map.terrain[tile]!;
  let delay: number;
  if (attack.target === NEUTRAL) {
    const speed = Math.max(
      expansion.minSpeedShare,
      Math.min(1, attack.troops / expansion.fullSpeedArmy),
    );
    delay = (expansion.layerDelayTicks * terrainValue(expansion.terrainDelay, terrain)) / speed;
  } else {
    const r = outnumbering(world, attack);
    const curve = r < 1 ? detPow(r, combat.crushExponent) : r;
    let ratio = clamp(curve, combat.delayRatioMin, combat.delayRatioMax);
    if (r > combat.hopelessRatio) ratio *= r / combat.hopelessRatio;
    delay = combat.layerDelayTicks * terrainValue(combat.terrainDelay, terrain) * ratio;
    // Traitors are overrun faster (GAME_DESIGN.md §3.14).
    if (isTraitor(world, getPlayer(world, attack.target)))
      delay *= world.rules.diplomacy.traitorDelay;
    // A wall (GAME_DESIGN.md §3.17.6) holds the front for a while.
    delay += wallHoldTicks(world, tile, ratio);
  }
  return delay;
}

/**
 * Virus-like spread: the attack's own network of thin, branching veins. Ridged noise
 * (two octaves) is near zero along thin lines; there the front races ahead, elsewhere it
 * creeps, so the territory grows in tendrils and fills in behind them.
 */
function growthResistance(world: World, attack: Attack, tile: number): number {
  const g = world.rules.attack.growth;
  const x = tile % world.map.width;
  const y = (tile - x) / world.map.width;
  const n =
    gradientNoise(attack.growthSeed, x * g.veinScale, y * g.veinScale) +
    0.5 * gradientNoise(attack.growthSeed + 1, x * g.veinScale * 2.3, y * g.veinScale * 2.3);
  const offVein = Math.min(1, Math.abs(n) * g.veinSharpness); // 0 on a vein, 1 between
  return g.onVein + (g.offVein - g.onVein) * offVein;
}

/** Troops the attacker pays to take `tile`. */
export function tileCost(world: World, attack: Attack, tile: number): number {
  const terrain = world.map.terrain[tile]!;
  if (attack.target === NEUTRAL) {
    // Scorched land (a strategic warhead, 2B.5) is dearer to settle for a while.
    return (
      attack.lossFactor *
      scorchedFactor(world, tile) *
      terrainValue(world.rules.expansion.costPerTile, terrain)
    );
  }
  const { combat } = world.rules;
  const defender = getPlayer(world, attack.target)!;
  const ratio = clamp(outnumbering(world, attack), combat.lossRatioMin, combat.lossRatioMax);
  const discount = attackLossFactor(
    world.rules,
    isTribe(getPlayer(world, attack.attacker)),
    isTribe(defender),
    isTraitor(world, defender),
    wallLossFactor(world, tile),
  );
  // Land under an air strike's suppression (2B.4) is cheaper to take.
  const suppressed = isSuppressed(world, tile) ? world.rules.flights.suppressedLoss : 1;
  return (
    attack.lossFactor *
      discount *
      suppressed *
      terrainValue(combat.terrainLoss, terrain) *
      ratio *
      (combat.lossBase + combat.lossDensity * defenderDensity(defender)) +
    wallBreakTroops(world, tile)
  );
}

/** r = defender's home troops ÷ attacking army: how outnumbered the attack is. */
function outnumbering(world: World, attack: Attack): number {
  const defender = getPlayer(world, attack.target)!;
  return attack.troops > 0 ? defender.homeTroops / attack.troops : Infinity;
}

/** d = defender's home troops per tile: what each lost tile costs the defender. */
function defenderDensity(defender: Player): number {
  return defender.tiles > 0 ? defender.homeTroops / defender.tiles : 0;
}

function ownNeighbors(world: World, tile: number, owner: PlayerId): number {
  const { width } = world.map;
  const x = tile % width;
  const o = world.owner;
  return (
    (tile >= width && o[tile - width] === owner ? 1 : 0) +
    (tile + width < o.length && o[tile + width] === owner ? 1 : 0) +
    (x > 0 && o[tile - 1] === owner ? 1 : 0) +
    (x < width - 1 && o[tile + 1] === owner ? 1 : 0)
  );
}

/** True if the player owns land next to the target's land (neutral land for target 0). */
export function bordersTarget(world: World, player: Player, target: PlayerId): boolean {
  const { map } = world;
  for (const tile of player.border) {
    const x = tile % map.width;
    if (tile >= map.width && isTargetLand(world, tile - map.width, target)) return true;
    if (tile + map.width < world.owner.length && isTargetLand(world, tile + map.width, target))
      return true;
    if (x > 0 && isTargetLand(world, tile - 1, target)) return true;
    if (x < map.width - 1 && isTargetLand(world, tile + 1, target)) return true;
  }
  return false;
}

/**
 * Everyone whose land touches the player's (0 = neutral land), in ascending order: who
 * a click can reach. Used by the HUD; iterates the player's border once.
 */
export function landNeighbors(world: World, player: Player): PlayerId[] {
  const { map, owner } = world;
  const found = new Set<PlayerId>();
  const check = (tile: number) => {
    const o = owner[tile]!;
    if (o !== player.id && isLand(map, tile)) found.add(o);
  };
  for (const tile of player.border) {
    const x = tile % map.width;
    if (tile >= map.width) check(tile - map.width);
    if (tile + map.width < owner.length) check(tile + map.width);
    if (x > 0) check(tile - 1);
    if (x < map.width - 1) check(tile + 1);
  }
  return [...found].sort((a, b) => a - b);
}

function isTargetLand(world: World, tile: number, target: PlayerId): boolean {
  return world.owner[tile] === target && isLand(world.map, tile);
}

type EndReason = "spent" | "complete" | "retreated" | "cancelled" | "eliminated";

/**
 * Ends an attack; survivors go home (minus the retreat penalty when retreating from a
 * player). An eliminated attacker's army is simply lost.
 */
function endAttack(world: World, attack: Attack, reason: EndReason): void {
  const attacker = getPlayer(world, attack.attacker)!;
  let survivors = reason === "eliminated" ? 0 : Math.max(0, attack.troops);
  if (reason === "retreated" && attack.target !== NEUTRAL && !attack.freeRetreat) {
    survivors *= 1 - world.rules.attack.retreatPenalty;
  }
  attacker.homeTroops += survivors;
  attack.troops = 0;
  attack.ended = true;
  if (attack.landingTile >= 0) attacker.encircleDirty = true; // see retreatAttack
  attack.front.clear();
  attack.scheduled.clear();
  world.events.push({
    type: "attackEnded",
    attackId: attack.id,
    attacker: attack.attacker,
    target: attack.target,
    reason,
    survivors,
  });
}

/**
 * A player is out of the game: their own armies are lost, and armies attacking them come
 * home (nothing is left to take).
 */
export function endAttacksInvolving(world: World, playerId: PlayerId): void {
  for (const attack of world.attacks) {
    if (attack.ended) continue;
    if (attack.attacker === playerId) endAttack(world, attack, "eliminated");
    else if (attack.target === playerId) endAttack(world, attack, "complete");
  }
  removeEnded(world);
  updateFieldTroops(world);
}

/** The match is over: every army stops and its survivors go home. */
export function endAllAttacks(world: World): void {
  for (const attack of world.attacks) if (!attack.ended) endAttack(world, attack, "complete");
  removeEnded(world);
  updateFieldTroops(world);
}

/**
 * The player with the biggest advancing army against `victim`, optionally only among
 * `candidates`; null if nobody is attacking them. Ties go to the lower player id.
 */
export function primaryAttacker(
  world: World,
  victim: PlayerId,
  candidates?: ReadonlyMap<PlayerId, number>,
): PlayerId | null {
  return strongestAttack(world, victim, candidates)?.attacker ?? null;
}

/** The biggest advancing army against `victim` (optionally only from `candidates`). */
export function strongestAttack(
  world: World,
  victim: PlayerId,
  candidates?: ReadonlyMap<PlayerId, number>,
): Attack | null {
  let best: Attack | null = null;
  for (const attack of world.attacks) {
    if (attack.ended || attack.retreatTick >= 0 || attack.target !== victim) continue;
    if (candidates && !candidates.has(attack.attacker)) continue;
    if (
      !best ||
      attack.troops > best.troops ||
      (attack.troops === best.troops && attack.attacker < best.attacker)
    ) {
      best = attack;
    }
  }
  return best && best.troops > 0 ? best : null;
}

function removeEnded(world: World): void {
  if (world.attacks.some((a) => a.ended)) world.attacks = world.attacks.filter((a) => !a.ended);
}

/** Field troops are always recomputed from the armies and boats, so they can never drift. */
export function updateFieldTroops(world: World): void {
  for (const player of world.players) player.fieldTroops = 0;
  for (const attack of world.attacks)
    getPlayer(world, attack.attacker)!.fieldTroops += attack.troops;
  for (const boat of world.boats) getPlayer(world, boat.owner)!.fieldTroops += boat.troops;
  for (const flight of world.flights) getPlayer(world, flight.owner)!.fieldTroops += flight.troops;
}

function distance(world: World, a: number, b: number): number {
  const dx = tileX(world.map, a) - tileX(world.map, b);
  const dy = tileY(world.map, a) - tileY(world.map, b);
  return Math.sqrt(dx * dx + dy * dy); // sqrt is exactly rounded by IEEE 754: deterministic
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
