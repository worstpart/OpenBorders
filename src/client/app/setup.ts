/**
 * The choices on the start screen (GAME_DESIGN.md §3.12–3.13): how many nations and
 * tribes, the nations' difficulty, and the map size.
 */
import { REFERENCE_MAP_HEIGHT, REFERENCE_MAP_WIDTH } from "../../sim/map/generate.ts";
import type { Difficulty } from "../../sim/rules.ts";
import { MAX_NATIONS, MAX_OPPONENTS } from "./players.ts";

export { MAX_NATIONS, MAX_OPPONENTS };

export const DEFAULT_NATIONS = 7;
export const DEFAULT_TRIBES = 25;
export const DEFAULT_DIFFICULTY: Difficulty = "medium";
/** Quick picks next to the tribes stepper (clicking + 100 times is no fun). */
export const TRIBE_PRESETS = [0, 25, 50, 100] as const;

/** Nations and tribes together stay within 1..MAX_OPPONENTS; nations win ties. */
export function clampLobby(nations: number, tribes: number): { nations: number; tribes: number } {
  const n = Math.max(0, Math.min(MAX_NATIONS, nations));
  const t = Math.max(0, Math.min(MAX_OPPONENTS - n, tribes));
  return n + t === 0 ? { nations: 1, tribes: 0 } : { nations: n, tribes: t };
}

export type MapSize = "normal" | "large";

/**
 * Both maps come from the same seed and generator. Large has ~2× the land (~850k tiles),
 * so a 126-player game gives each start about as much room as a 63-player game on Normal.
 */
export const MAP_SIZES: Record<MapSize, { label: string; width: number; height: number }> = {
  normal: { label: "Normal", width: REFERENCE_MAP_WIDTH, height: REFERENCE_MAP_HEIGHT },
  large: { label: "Large", width: 1560, height: 990 },
};

/** Land per player at the start, if the land were shared evenly (shown on the start screen). */
export function landPerPlayer(landTiles: number, opponents: number): number {
  return Math.round(landTiles / (opponents + 1));
}
