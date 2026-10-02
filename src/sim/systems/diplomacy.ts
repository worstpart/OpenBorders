/**
 * Alliances (GAME_DESIGN.md §3.14).
 *
 *  - A player asks another for an alliance; the request expires after `requestTicks`, and
 *    the same player can't be asked again for `requestCooldownTicks`. Two players asking
 *    each other are allies at once.
 *  - Allies can't attack each other. Armies already fighting between them come home
 *    without the usual retreat loss.
 *  - An alliance lasts `durationTicks`. During its last `renewWindowTicks` both sides may
 *    renew it; if both do, it lasts another `durationTicks`.
 *  - Breaking one marks the breaker a traitor for `traitorTicks`: attacks on them cost
 *    less and move faster (attacks.ts), tribes go after them, and the betrayed nation
 *    holds a grudge.
 *
 * In team games (GAME_DESIGN.md §3.15) teammates are permanently friendly; alliances with
 * players outside the team work exactly as above.
 */
import {
  getPlayer,
  pairKey,
  requestKey,
  sameTeam,
  type Alliance,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import { retreatAttack } from "./attacks.ts";

export function isAllied(world: World, a: PlayerId, b: PlayerId): boolean {
  return a !== b && world.alliances.has(pairKey(a, b));
}

/** Can't attack or encircle each other: teammates, or allies (GAME_DESIGN.md §3.15). */
export function areFriendly(world: World, a: PlayerId, b: PlayerId): boolean {
  return sameTeam(world, a, b) || isAllied(world, a, b);
}

export function getAlliance(world: World, a: PlayerId, b: PlayerId): Alliance | undefined {
  return a === b ? undefined : world.alliances.get(pairKey(a, b));
}

/** How many alliances the player is in. */
export function allianceCount(world: World, id: PlayerId): number {
  let count = 0;
  for (const alliance of world.alliances.values()) {
    if (alliance.a === id || alliance.b === id) count++;
  }
  return count;
}

/** Marked a traitor right now (broke an alliance recently). */
export function isTraitor(world: World, player: Player | undefined): boolean {
  return !!player && player.traitorUntilTick > world.tick;
}

/** The alliance has entered its renewal window (its last `renewWindowTicks`). */
export function inRenewWindow(world: World, alliance: Alliance): boolean {
  return world.tick >= alliance.expiresTick - world.rules.diplomacy.renewWindowTicks;
}

/** The open request from `from` to `to`, if any. */
export function findRequest(world: World, from: PlayerId, to: PlayerId) {
  return world.allianceRequests.find((r) => r.from === from && r.to === to);
}

/** Handles `allianceRequest`. Returns a rejection reason, or null on success. */
export function applyAllianceRequest(
  world: World,
  player: Player,
  target: PlayerId,
): string | null {
  const rules = world.rules.diplomacy;
  if (!rules.enabled) return "alliances are off in this game";
  if (world.phase !== "playing") return "the match hasn't started";
  if (!Number.isInteger(target) || target === player.id) return "invalid player";
  const other = getPlayer(world, target);
  if (!other?.alive) return "that player is gone";
  if (sameTeam(world, player.id, target)) return "you're on the same team";
  if (isAllied(world, player.id, target)) return "already allied";
  // They asked us first: asking back accepts.
  if (findRequest(world, target, player.id)) {
    removeRequest(world, target, player.id);
    formAlliance(world, player.id, target);
    return null;
  }
  if (findRequest(world, player.id, target)) return "request already sent";
  const last = world.lastRequestTick.get(requestKey(player.id, target));
  if (last !== undefined && world.tick - last < rules.requestCooldownTicks) {
    return "asked them too recently";
  }
  world.allianceRequests.push({
    from: player.id,
    to: target,
    expiresTick: world.tick + rules.requestTicks,
  });
  world.lastRequestTick.set(requestKey(player.id, target), world.tick);
  world.events.push({ type: "allianceRequested", from: player.id, to: target });
  return null;
}

/** Handles `allianceReply`. */
export function applyAllianceReply(
  world: World,
  player: Player,
  from: PlayerId,
  accept: boolean,
): string | null {
  if (!findRequest(world, from, player.id)) return "no such request";
  removeRequest(world, from, player.id);
  if (accept) formAlliance(world, from, player.id);
  else world.events.push({ type: "allianceRequestEnded", from, to: player.id, reason: "declined" });
  return null;
}

/** Handles `allianceRenew`: once both allies agreed, the alliance is extended. */
export function applyAllianceRenew(world: World, player: Player, ally: PlayerId): string | null {
  const alliance = getAlliance(world, player.id, ally);
  if (!alliance) return "not allied";
  if (!inRenewWindow(world, alliance)) return "too early to renew";
  if (alliance.a === player.id) alliance.renewA = true;
  else alliance.renewB = true;
  if (alliance.renewA && alliance.renewB) {
    alliance.expiresTick += world.rules.diplomacy.durationTicks;
    alliance.renewA = false;
    alliance.renewB = false;
    world.events.push({ type: "allianceRenewed", a: alliance.a, b: alliance.b });
  }
  return null;
}

/** Handles `allianceBreak`: the alliance ends now and the breaker is a traitor. */
export function applyAllianceBreak(world: World, player: Player, ally: PlayerId): string | null {
  const alliance = getAlliance(world, player.id, ally);
  if (!alliance) return "not allied";
  const rules = world.rules;
  endAlliance(world, alliance);
  player.traitorUntilTick = world.tick + rules.diplomacy.traitorTicks;
  player.betrayals++;
  const victim = getPlayer(world, ally)!;
  victim.brain?.grudges.set(player.id, world.tick + rules.ai.grudgeTicks);
  world.events.push({ type: "allianceBroken", breaker: player.id, victim: ally });
  return null;
}

/** Tick system: requests and alliances run out. */
export function updateDiplomacy(world: World): void {
  if (world.allianceRequests.length > 0) {
    const open = [];
    for (const request of world.allianceRequests) {
      if (world.tick < request.expiresTick) open.push(request);
      else {
        world.events.push({
          type: "allianceRequestEnded",
          from: request.from,
          to: request.to,
          reason: "expired",
        });
      }
    }
    world.allianceRequests = open;
  }
  for (const alliance of world.alliances.values()) {
    if (world.tick < alliance.expiresTick) continue;
    endAlliance(world, alliance);
    world.events.push({ type: "allianceEnded", a: alliance.a, b: alliance.b, reason: "expired" });
  }
  // Forget requests nobody looks at any more (the AI waits longest between requests).
  const memory = Math.max(
    world.rules.diplomacy.requestCooldownTicks,
    world.rules.ai.allyRequestEveryTicks,
  );
  for (const [key, tick] of world.lastRequestTick) {
    if (world.tick - tick >= memory) world.lastRequestTick.delete(key);
  }
}

/** An eliminated player's alliances end and their requests vanish. */
export function dropDiplomacy(world: World, id: PlayerId): void {
  world.allianceRequests = world.allianceRequests.filter((r) => r.from !== id && r.to !== id);
  for (const alliance of world.alliances.values()) {
    if (alliance.a !== id && alliance.b !== id) continue;
    endAlliance(world, alliance);
    world.events.push({
      type: "allianceEnded",
      a: alliance.a,
      b: alliance.b,
      reason: "eliminated",
    });
  }
}

function formAlliance(world: World, x: PlayerId, y: PlayerId): void {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  removeRequest(world, b, a);
  removeRequest(world, a, b);
  world.alliances.set(pairKey(a, b), {
    a,
    b,
    formedTick: world.tick,
    expiresTick: world.tick + world.rules.diplomacy.durationTicks,
    renewA: false,
    renewB: false,
  });
  // Peace at once: armies fighting between them come home, without the retreat loss.
  for (const attack of world.attacks) {
    const between =
      (attack.attacker === a && attack.target === b) ||
      (attack.attacker === b && attack.target === a);
    if (between && !attack.ended && attack.retreatTick < 0) retreatAttack(world, attack, true);
  }
  world.events.push({ type: "allianceFormed", a, b });
}

function endAlliance(world: World, alliance: Alliance): void {
  world.alliances.delete(pairKey(alliance.a, alliance.b));
  // Land enclosed by the former ally can now be encircled.
  getPlayer(world, alliance.a)!.encircleDirty = true;
  getPlayer(world, alliance.b)!.encircleDirty = true;
}

function removeRequest(world: World, from: PlayerId, to: PlayerId): void {
  const index = world.allianceRequests.findIndex((r) => r.from === from && r.to === to);
  if (index >= 0) world.allianceRequests.splice(index, 1);
}
