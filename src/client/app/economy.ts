/**
 * What the HUD shows about gold (GAME_DESIGN.md §3.16): the Mobilize button and the
 * donation options for a friend. Pure functions over frame snapshots, so they can be
 * tested without the UI; the numbers come from the simulation's own formulas.
 */
import type { PlayerSnapshot } from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import { donationAmount, mobilizeTroops, troopRoom } from "../../sim/systems/economy.ts";
import type { DonationResource, PlayerId } from "../../sim/world.ts";

/** One Mobilize click (or M) buys this share (%) of the capacity. */
export const MOBILIZE_PERCENT = 10;

export interface MobilizePreview {
  /** Troops one click raises (0 = none). */
  readonly troops: number;
  readonly gold: number;
  /** Why it can't be used now, if it can't. */
  readonly blocked: "full" | "noGold" | null;
}

export function mobilizePreview(rules: GameRules, me: PlayerSnapshot): MobilizePreview {
  if (troopRoom(me) < 1) return { troops: 0, gold: 0, blocked: "full" };
  const troops = mobilizeTroops(rules, me, MOBILIZE_PERCENT * 100);
  if (troops < 1) return { troops: 0, gold: 0, blocked: "noGold" };
  return { troops, gold: troops * rules.economy.goldPerTroop, blocked: null };
}

/** Key of the local player's last donation of a resource to a friend (see ui.myDonations). */
export function donationKeyOf(to: PlayerId, resource: DonationResource): string {
  return `${to}:${resource}`;
}

export interface DonationOption {
  readonly resource: DonationResource;
  /** What a click gives now (0 when blocked). */
  readonly amount: number;
  /** Seconds left on the cooldown (0 = ready). */
  readonly secondsLeft: number;
  readonly blocked: "cooldown" | "theyAreFull" | "nothing" | null;
}

export interface DonationContext {
  readonly rules: GameRules;
  readonly tick: number;
  readonly me: PlayerSnapshot | undefined;
  /** Tick of the local player's last donation, by donationKeyOf(to, resource). */
  readonly myDonations: ReadonlyMap<string, number>;
}

/** The two donation options for `friend`, sending `percent`% of our troops or gold. */
export function donationOptions(
  ctx: DonationContext,
  friend: PlayerSnapshot,
  percent: number,
): DonationOption[] {
  const me = ctx.me;
  if (!me) return [];
  const cooldown = ctx.rules.economy.donationCooldownTicks;
  return (["troops", "gold"] as const).map((resource) => {
    const last = ctx.myDonations.get(donationKeyOf(friend.id, resource));
    const ticksLeft = last === undefined ? 0 : Math.max(0, last + cooldown - ctx.tick);
    const secondsLeft = (ticksLeft * ctx.rules.tickMs) / 1000;
    if (ticksLeft > 0) return { resource, amount: 0, secondsLeft, blocked: "cooldown" };
    if (resource === "troops" && troopRoom(friend) < 1) {
      return { resource, amount: 0, secondsLeft: 0, blocked: "theyAreFull" };
    }
    const amount = donationAmount(me, friend, resource, percent * 100);
    return { resource, amount, secondsLeft: 0, blocked: amount < 1 ? "nothing" : null };
  });
}
