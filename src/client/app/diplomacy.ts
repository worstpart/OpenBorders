/**
 * The local player's diplomacy as the HUD shows it (GAME_DESIGN.md §3.14): where an
 * alliance with someone stands (right-click menu, hover card) and which decisions are
 * waiting for an answer (the diplomacy cards). Mirrors the simulation's checks, so the HUD
 * never offers something the game will reject.
 */
import type { AllianceRequestSnapshot, AllianceSnapshot, PlayerSnapshot } from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import type { Phase, PlayerId } from "../../sim/world.ts";
import { formatClock } from "../format.ts";

export interface DiplomacyContext {
  readonly rules: GameRules;
  readonly phase: Phase;
  readonly tick: number;
  readonly me: PlayerSnapshot | undefined;
  readonly players: readonly PlayerSnapshot[];
  readonly alliances: readonly AllianceSnapshot[];
  readonly requests: readonly AllianceRequestSnapshot[];
  /** Tick of the local player's last request to each player. */
  readonly myRequests: ReadonlyMap<PlayerId, number>;
}

export type AllianceStatus =
  | {
      readonly kind: "ally";
      readonly secondsLeft: number;
      /** In the renewal window (the last 30 s)… */
      readonly renewable: boolean;
      /** …and whether each side has already agreed. */
      readonly renewedByMe: boolean;
      readonly renewedByThem: boolean;
    }
  /** They asked us: asking back accepts. */
  | { readonly kind: "theyAsked"; readonly secondsLeft: number }
  | { readonly kind: "sent"; readonly secondsLeft: number }
  | { readonly kind: "cooldown"; readonly secondsLeft: number }
  | { readonly kind: "canAsk" }
  /** No alliance possible: alliances off, not playing, ourselves, neutral, or gone. */
  | { readonly kind: "none" };

const seconds = (rules: GameRules, ticks: number): number =>
  Math.max(0, (ticks * rules.tickMs) / 1000);

export function allianceWith(
  alliances: readonly AllianceSnapshot[],
  me: PlayerId,
  other: PlayerId,
): AllianceSnapshot | undefined {
  return alliances.find((a) => (a.a === me && a.b === other) || (a.b === me && a.a === other));
}

/** Where an alliance between the local player and `target` stands. */
export function allianceStatus(ctx: DiplomacyContext, target: PlayerId): AllianceStatus {
  const { rules, tick, me } = ctx;
  if (!rules.diplomacy.enabled || ctx.phase !== "playing" || !me?.alive) return { kind: "none" };
  const other = ctx.players[target - 1];
  if (target === 0 || target === me.id || !other?.alive) return { kind: "none" };
  const alliance = allianceWith(ctx.alliances, me.id, target);
  if (alliance) {
    const meIsA = alliance.a === me.id;
    return {
      kind: "ally",
      secondsLeft: seconds(rules, alliance.expiresTick - tick),
      renewable: tick >= alliance.expiresTick - rules.diplomacy.renewWindowTicks,
      renewedByMe: meIsA ? alliance.renewA : alliance.renewB,
      renewedByThem: meIsA ? alliance.renewB : alliance.renewA,
    };
  }
  const theirs = ctx.requests.find((r) => r.from === target && r.to === me.id);
  if (theirs) return { kind: "theyAsked", secondsLeft: seconds(rules, theirs.expiresTick - tick) };
  const mine = ctx.requests.find((r) => r.from === me.id && r.to === target);
  if (mine) return { kind: "sent", secondsLeft: seconds(rules, mine.expiresTick - tick) };
  const last = ctx.myRequests.get(target);
  if (last !== undefined && tick - last < rules.diplomacy.requestCooldownTicks) {
    return {
      kind: "cooldown",
      secondsLeft: seconds(rules, last + rules.diplomacy.requestCooldownTicks - tick),
    };
  }
  return { kind: "canAsk" };
}

/** A decision waiting for the local player: answer a request, or renew an alliance. */
export type DiplomacyCard =
  | {
      readonly kind: "request";
      readonly from: PlayerId;
      readonly secondsLeft: number;
      /** Time left as a share of the whole request time (for the countdown bar). */
      readonly share: number;
    }
  | {
      readonly kind: "renew";
      readonly ally: PlayerId;
      readonly secondsLeft: number;
      readonly share: number;
      /** We agreed; waiting for them. */
      readonly waiting: boolean;
    };

/** Open decisions, oldest request first, then renewals by time left. */
export function diplomacyCards(ctx: DiplomacyContext): DiplomacyCard[] {
  const { rules, tick, me } = ctx;
  if (!rules.diplomacy.enabled || ctx.phase !== "playing" || !me?.alive) return [];
  const d = rules.diplomacy;
  const cards: DiplomacyCard[] = [];
  for (const r of ctx.requests) {
    if (r.to !== me.id) continue;
    cards.push({
      kind: "request",
      from: r.from,
      secondsLeft: seconds(rules, r.expiresTick - tick),
      share: Math.max(0, Math.min(1, (r.expiresTick - tick) / d.requestTicks)),
    });
  }
  const renewals: DiplomacyCard[] = [];
  for (const a of ctx.alliances) {
    if (a.a !== me.id && a.b !== me.id) continue;
    if (tick < a.expiresTick - d.renewWindowTicks) continue;
    renewals.push({
      kind: "renew",
      ally: a.a === me.id ? a.b : a.a,
      secondsLeft: seconds(rules, a.expiresTick - tick),
      share: Math.max(0, Math.min(1, (a.expiresTick - tick) / d.renewWindowTicks)),
      waiting: a.a === me.id ? a.renewA : a.renewB,
    });
  }
  renewals.sort((x, y) => x.secondsLeft - y.secondsLeft);
  return [...cards, ...renewals];
}

/** The local player's allies (ids). */
export function alliesOf(alliances: readonly AllianceSnapshot[], me: PlayerId): Set<PlayerId> {
  const allies = new Set<PlayerId>();
  for (const a of alliances) {
    if (a.a === me) allies.add(a.b);
    else if (a.b === me) allies.add(a.a);
  }
  return allies;
}

/** Seconds a player stays marked a traitor (0 = not a traitor). */
export function traitorSecondsLeft(
  rules: GameRules,
  tick: number,
  player: PlayerSnapshot | undefined,
): number {
  return player ? seconds(rules, player.traitorUntilTick - tick) : 0;
}

/** Time left, rounded up: 191.2 s → "3:12". */
export function formatCountdown(totalSeconds: number): string {
  return formatClock(Math.ceil(totalSeconds));
}
