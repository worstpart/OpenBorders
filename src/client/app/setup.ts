/**
 * The choices on the start screen (milestone 2.0, GAME_DESIGN.md §3.12): how many
 * opponents and which map size.
 */
import { REFERENCE_MAP_HEIGHT, REFERENCE_MAP_WIDTH } from "../../sim/map/generate.ts";

export { MAX_OPPONENTS } from "./players.ts";

export const DEFAULT_OPPONENTS = 7;
/** Quick picks next to the stepper (clicking +/− 125 times is no fun). */
export const OPPONENT_PRESETS = [7, 25, 50, 125] as const;

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
