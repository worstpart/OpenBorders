/**
 * The attack percentage: the share of your home troops a click sends (GAME_DESIGN.md
 * §4.1). Presets on keys 1–5; Q/E and Shift+wheel step by 5.
 */

export const ATTACK_PRESETS = [10, 25, 50, 75, 100] as const;
export const DEFAULT_ATTACK_PERCENT = 25;
const STEP = 5;
const MIN = 5;
const MAX = 100;

/** The percentage after `steps` steps of 5 (negative = less), kept within 5–100. */
export function stepPercent(percent: number, steps: number): number {
  return Math.min(MAX, Math.max(MIN, percent + steps * STEP));
}

/** The preset for keys 1–5 (index 0–4). */
export function presetPercent(index: number): number {
  return ATTACK_PRESETS[Math.max(0, Math.min(ATTACK_PRESETS.length - 1, index))]!;
}

/** Troops a click would send right now (the simulation computes the same with the pool at execution). */
export function troopsToSend(homeTroops: number, percent: number): number {
  return Math.floor((homeTroops * percent) / 100);
}
