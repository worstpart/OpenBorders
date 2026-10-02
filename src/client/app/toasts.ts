/**
 * Toasts (GAME_DESIGN.md §5.1): short, auto-dismissing messages at the top center, at
 * most three at a time. Only moments that matter to the local player become toasts —
 * a feed of every bot skirmish would be noise.
 */
import type { SimEvent } from "../../sim/events.ts";
import type { PlayerId } from "../../sim/world.ts";

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

/** Adds a toast, dropping the oldest beyond `max`. */
export function addToast(list: readonly Toast[], toast: Toast, max = MAX_TOASTS): Toast[] {
  return [...list, toast].slice(-max);
}

/** The toasts a tick's events produce for the local player. */
export function toastsForEvents(
  events: readonly SimEvent[],
  me: PlayerId,
  nameOf: (id: PlayerId) => string,
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
      case "phaseChanged":
        if (event.phase === "playing") {
          toasts.push({ text: "The match has started — expand!", tone: "info" });
        }
        break;
    }
  }
  return toasts;
}
