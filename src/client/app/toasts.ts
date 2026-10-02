/**
 * Toasts (GAME_DESIGN.md §5.1): short, auto-dismissing messages at the top center, at
 * most three at a time. Only moments that matter to the local player become toasts —
 * a feed of every bot skirmish would be noise.
 */
import type { SimEvent } from "../../sim/events.ts";
import { DEFAULT_RULES } from "../../sim/rules.ts";
import type { PlayerId } from "../../sim/world.ts";

const TRAITOR_SECONDS = (DEFAULT_RULES.diplomacy.traitorTicks * DEFAULT_RULES.tickMs) / 1000;
const TRAITOR_DISCOUNT = Math.round((1 - DEFAULT_RULES.diplomacy.traitorLoss) * 100);

export type ToastTone = "info" | "success" | "danger";

export interface ToastInput {
  readonly text: string;
  readonly tone: ToastTone;
  /** A player whose color marks the toast. */
  readonly player?: PlayerId;
}

export interface Toast extends ToastInput {
  readonly id: number;
}

export const MAX_TOASTS = 3;
/** Smaller encirclements (slivers cut off along a front) happen all the time: not news. */
export const ENCIRCLE_TOAST_MIN_TILES = 25;
export const TOAST_MS = 4_500;
/**
 * Above this many players (milestone 2.0 big lobbies) other players' eliminations are only
 * news when they bordered you — with 125 bots, a toast per elimination would be a flood.
 */
export const BIG_LOBBY_PLAYERS = 16;

/** Adds a toast, dropping the oldest beyond `max`. */
export function addToast(list: readonly Toast[], toast: Toast, max = MAX_TOASTS): Toast[] {
  return [...list, toast].slice(-max);
}

/**
 * The toasts a tick's events produce for the local player. `isNews` decides whether
 * another player's elimination (not by us), or a betrayal between others, is worth a toast.
 * Alliance requests to us become diplomacy cards, not toasts.
 */
export function toastsForEvents(
  events: readonly SimEvent[],
  me: PlayerId,
  nameOf: (id: PlayerId) => string,
  isNews: (eliminated: PlayerId) => boolean = () => true,
): ToastInput[] {
  const toasts: ToastInput[] = [];
  for (const event of events) {
    switch (event.type) {
      case "attackStarted":
        if (event.target === me) {
          toasts.push({
            text: `${nameOf(event.attacker)} is attacking you`,
            tone: "danger",
            player: event.attacker,
          });
        }
        break;
      case "attackEnded":
        if (event.attacker === me && event.target !== 0) {
          if (event.reason === "cancelled") {
            toasts.push({
              text: `${nameOf(event.target)}'s army cancelled out your attack`,
              tone: "info",
              player: event.target,
            });
          } else if (event.reason === "spent") {
            toasts.push({
              text: `Your attack on ${nameOf(event.target)} ran out of troops`,
              tone: "info",
              player: event.target,
            });
          }
        }
        break;
      case "encircled":
        if (event.tiles < ENCIRCLE_TOAST_MIN_TILES) break;
        if (event.by === me) {
          toasts.push({
            text: `You encircled ${event.tiles.toLocaleString("en-US")} tiles of ${nameOf(event.playerId)}`,
            tone: "success",
            player: event.playerId,
          });
        } else if (event.playerId === me) {
          toasts.push({
            text: `${nameOf(event.by)} encircled ${event.tiles.toLocaleString("en-US")} of your tiles`,
            tone: "danger",
            player: event.by,
          });
        }
        break;
      case "eliminated":
        if (event.playerId === me) break; // the defeat card says it
        if (event.by !== me && !isNews(event.playerId)) break;
        toasts.push(
          event.by === me
            ? {
                text: `You eliminated ${nameOf(event.playerId)}`,
                tone: "success",
                player: event.playerId,
              }
            : {
                text:
                  event.by !== null
                    ? `${nameOf(event.by)} eliminated ${nameOf(event.playerId)}`
                    : `${nameOf(event.playerId)} was eliminated`,
                tone: "info",
                player: event.playerId,
              },
        );
        break;
      case "allianceRequested":
        if (event.from === me) {
          toasts.push({
            text: `Alliance request sent to ${nameOf(event.to)}`,
            tone: "info",
            player: event.to,
          });
        }
        break;
      case "allianceRequestEnded":
        if (event.from === me) {
          toasts.push({
            text:
              event.reason === "declined"
                ? `${nameOf(event.to)} declined your alliance`
                : `${nameOf(event.to)} didn't answer your alliance request`,
            tone: "info",
            player: event.to,
          });
        }
        break;
      case "allianceFormed":
      case "allianceRenewed": {
        const other = event.a === me ? event.b : event.b === me ? event.a : null;
        if (other === null) break;
        toasts.push({
          text:
            event.type === "allianceFormed"
              ? `You are now allied with ${nameOf(other)}`
              : `Alliance with ${nameOf(other)} renewed`,
          tone: "success",
          player: other,
        });
        break;
      }
      case "allianceEnded": {
        const other = event.a === me ? event.b : event.b === me ? event.a : null;
        if (other === null || event.reason !== "expired") break;
        toasts.push({
          text: `Your alliance with ${nameOf(other)} has ended`,
          tone: "info",
          player: other,
        });
        break;
      }
      case "allianceBroken":
        if (event.breaker === me) {
          toasts.push({
            text: `You betrayed ${nameOf(event.victim)} — you're a traitor for ${TRAITOR_SECONDS} s`,
            tone: "danger",
            player: event.victim,
          });
        } else if (event.victim === me) {
          toasts.push({
            text: `${nameOf(event.breaker)} betrayed you! Attacking them costs ${TRAITOR_DISCOUNT}% less for ${TRAITOR_SECONDS} s`,
            tone: "danger",
            player: event.breaker,
          });
        } else if (isNews(event.breaker) || isNews(event.victim)) {
          toasts.push({
            text: `${nameOf(event.breaker)} betrayed ${nameOf(event.victim)}`,
            tone: "info",
            player: event.breaker,
          });
        }
        break;
      case "phaseChanged":
        if (event.phase === "playing") {
          toasts.push({ text: "The match has started — expand!", tone: "info" });
        }
        break;
    }
  }
  return toasts;
}
