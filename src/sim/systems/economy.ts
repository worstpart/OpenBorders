/**
 * Gold (GAME_DESIGN.md §3.16).
 *
 *  - Every tick of play each living player earns incomeBase + incomePerSqrtTile · √tiles
 *    gold (tribes a share of it, which they never spend).
 *  - Mobilize turns gold into home troops at goldPerTroop, never past the capacity.
 *  - Allies and teammates can give each other home troops (only what fits under the
 *    friend's capacity) or gold, each kind to each friend at most every
 *    donationCooldownTicks.
 *  - Whoever eliminates a player takes lootShare of their gold.
 *
 * With rules.economy.enabled = false nothing here runs and games play as in 2.3.
 */
import {
  donationKey,
  getPlayer,
  isTribe,
  type DonationResource,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import { areFriendly } from "./diplomacy.ts";
import type { GameRules } from "../rules.ts";

/** Gold a player with `tiles` tiles earns per tick (`share` < 1 for tribes). Integer. */
export function goldIncome(rules: GameRules, tiles: number, share = 1): number {
  const economy = rules.economy;
  if (!economy.enabled || tiles <= 0) return 0;
  return Math.floor(share * (economy.incomeBase + economy.incomePerSqrtTile * Math.sqrt(tiles)));
}

/** This player's income per tick. */
export function incomeOf(rules: GameRules, player: Player): number {
  return goldIncome(rules, player.tiles, isTribe(player) ? rules.economy.tribeIncomeShare : 1);
}

/** Tick system (step 6b): income, and forgetting donation cooldowns that are over. */
export function earnGold(world: World): void {
  const rules = world.rules;
  if (!rules.economy.enabled) return;
  for (const player of world.players) {
    if (!player.alive) continue;
    player.lastIncome = incomeOf(rules, player);
    player.gold += player.lastIncome;
  }
  const cooldown = rules.economy.donationCooldownTicks;
  for (const [key, tick] of world.lastDonationTick) {
    if (world.tick - tick >= cooldown) world.lastDonationTick.delete(key);
  }
}

/** Room under the troop cap. */
export function troopRoom(player: { capacity: number; homeTroops: number; fieldTroops: number }) {
  return Math.max(0, Math.floor(player.capacity - player.homeTroops - player.fieldTroops));
}

/**
 * Troops a mobilize of `percentBp` of capacity raises: limited by the room under the cap
 * and by the gold (0 = none). Shared with the HUD.
 */
export function mobilizeTroops(
  rules: GameRules,
  player: { capacity: number; homeTroops: number; fieldTroops: number; gold: number },
  percentBp: number,
): number {
  const wanted = Math.floor((player.capacity * percentBp) / 10_000);
  const affordable = Math.floor(player.gold / rules.economy.goldPerTroop);
  return Math.max(0, Math.min(wanted, troopRoom(player), affordable));
}

/** Handles `mobilize`. Returns a rejection reason, or null on success. */
export function applyMobilize(world: World, player: Player, percentBp: number): string | null {
  if (!world.rules.economy.enabled) return "there is no gold in this game";
  if (world.phase !== "playing") return "the match hasn't started";
  if (!Number.isInteger(percentBp) || percentBp < 1 || percentBp > 10_000) {
    return "invalid percentage";
  }
  if (troopRoom(player) < 1) return "your army is full";
  const troops = mobilizeTroops(world.rules, player, percentBp);
  if (troops < 1) return "not enough gold";
  const gold = troops * world.rules.economy.goldPerTroop;
  player.gold -= gold;
  player.homeTroops += troops;
  world.events.push({ type: "mobilized", playerId: player.id, troops, gold });
  return null;
}

/** Ticks until `from` may give `to` this resource again (0 = now). */
export function donationCooldownLeft(
  world: World,
  from: PlayerId,
  to: PlayerId,
  resource: DonationResource,
): number {
  const last = world.lastDonationTick.get(donationKey(from, to, resource));
  if (last === undefined) return 0;
  return Math.max(0, last + world.rules.economy.donationCooldownTicks - world.tick);
}

/** How much a donation of `percentBp` gives (troops only what fits under the friend's cap). */
export function donationAmount(
  giver: { homeTroops: number; gold: number },
  friend: { capacity: number; homeTroops: number; fieldTroops: number },
  resource: DonationResource,
  percentBp: number,
): number {
  if (resource === "gold") return Math.floor((giver.gold * percentBp) / 10_000);
  return Math.min(Math.floor((giver.homeTroops * percentBp) / 10_000), troopRoom(friend));
}

/** Handles `donate`. Returns a rejection reason, or null on success. */
export function applyDonate(
  world: World,
  player: Player,
  to: PlayerId,
  resource: DonationResource,
  percentBp: number,
): string | null {
  if (!world.rules.economy.enabled) return "donations are off in this game";
  if (world.phase !== "playing") return "the match hasn't started";
  if (resource !== "troops" && resource !== "gold") return "invalid resource";
  if (!Number.isInteger(percentBp) || percentBp < 1 || percentBp > 10_000) {
    return "invalid percentage";
  }
  if (!Number.isInteger(to) || to === player.id) return "invalid player";
  const friend = getPlayer(world, to);
  if (!friend?.alive) return "that player is gone";
  if (!areFriendly(world, player.id, to)) return "only allies and teammates";
  if (donationCooldownLeft(world, player.id, to, resource) > 0) {
    return "gave them that too recently";
  }
  if (resource === "troops" && troopRoom(friend) < 1) return "their army is full";
  const amount = donationAmount(player, friend, resource, percentBp);
  if (amount < 1) return resource === "gold" ? "no gold to give" : "no troops to give";
  if (resource === "gold") {
    player.gold -= amount;
    friend.gold += amount;
  } else {
    player.homeTroops -= amount;
    friend.homeTroops += amount;
  }
  world.lastDonationTick.set(donationKey(player.id, to, resource), world.tick);
  world.events.push({ type: "donated", from: player.id, to, resource, amount });
  return null;
}

/** An eliminated player's treasury: `by` takes its share, the rest is lost. Returns the loot. */
export function lootGold(world: World, victim: Player, by: PlayerId | null): number {
  const winner = by === null ? undefined : getPlayer(world, by);
  const loot = winner?.alive ? Math.floor(victim.gold * world.rules.economy.lootShare) : 0;
  if (winner) winner.gold += loot;
  victim.gold = 0;
  victim.lastIncome = 0;
  return loot;
}
