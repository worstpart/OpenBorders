/**
 * The troop bar on the command bar (GAME_DESIGN.md §5.1): home troops against capacity,
 * the 50% sweet spot, and the slice a click would send — so you see where you'd land
 * relative to the sweet spot *before* clicking. Growth is fastest at half capacity
 * (§3.4), and managing that decides games.
 */
import { troopsToSend } from "./attackPercent.ts";

/** How well troops are growing at a given fill (home troops ÷ capacity). */
export type GrowthState = "full" | "slowing" | "peak" | "rebuilding";

export interface TroopBarModel {
  /** Shares of capacity (0–1), for drawing. */
  readonly home: number;
  readonly field: number;
  /** The part of `home` a click would send. */
  readonly send: number;
  /** Home share right after sending. */
  readonly after: number;
  readonly sendTroops: number;
  readonly state: GrowthState;
  /** Growth state right after sending. */
  readonly afterState: GrowthState;
}

/** At or above this fill troops barely grow (they stop at the cap). */
const FULL_AT = 0.95;
/** Between these, growth is within ~90% of its peak (4x(1−x) ≥ 0.9 near x = 0.5). */
const PEAK_FROM = 0.35;
const PEAK_TO = 0.65;

export function growthState(share: number): GrowthState {
  if (share >= FULL_AT) return "full";
  if (share > PEAK_TO) return "slowing";
  if (share >= PEAK_FROM) return "peak";
  return "rebuilding";
}

export function troopBarModel(
  homeTroops: number,
  fieldTroops: number,
  capacity: number,
  percent: number,
): TroopBarModel {
  const cap = Math.max(1, capacity);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const sendTroops = troopsToSend(homeTroops, percent);
  const home = clamp(homeTroops / cap);
  const field = clamp(fieldTroops / cap);
  const after = clamp((homeTroops - sendTroops) / cap);
  return {
    home,
    field: Math.min(field, 1 - home),
    send: home - after,
    after,
    sendTroops,
    state: growthState(home),
    afterState: growthState(after),
  };
}

/** Short status text for each growth state, written for a first-time player. */
export const GROWTH_TEXT: Record<GrowthState, string> = {
  full: "Full — not growing. Send troops!",
  slowing: "Above half — growth slowing",
  peak: "Near half — fastest growth",
  rebuilding: "Low — rebuilding slowly",
};
