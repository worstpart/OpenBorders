/**
 * The choices on the start screen (GAME_DESIGN.md §3.12–3.13, §3.2): how many nations and
 * tribes, the nations' difficulty, and the map (type, size, which one).
 */
import {
  MAP_DIMENSIONS,
  MAP_SIZE_NAMES,
  MAP_STYLES,
  type MapSize,
  type MapStyle,
} from "../../sim/map/generate.ts";
import type { Difficulty } from "../../sim/rules.ts";
import { MAX_NATIONS, MAX_OPPONENTS } from "./players.ts";

export { MAX_NATIONS, MAX_OPPONENTS, MAP_SIZE_NAMES, MAP_STYLES };
export type { MapSize, MapStyle };

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

/**
 * Every size comes from the same generator. Large has ~2× the land of Normal, Huge ~4×,
 * so a 126-player game on Huge gives each start about the room of a 30-player game on Normal.
 */
export const MAP_SIZES: Record<MapSize, { label: string; width: number; height: number }> = {
  normal: { label: "Normal", ...MAP_DIMENSIONS.normal },
  large: { label: "Large", ...MAP_DIMENSIONS.large },
  huge: { label: "Huge", ...MAP_DIMENSIONS.huge },
};

/** Map types (2.8): what each button says. */
export const MAP_STYLE_LABELS: Record<MapStyle, string> = {
  continent: "Continent",
  archipelago: "Islands",
  twin: "Two lands",
};

/**
 * The map every game used until 2.8; the start screen begins with it, and 🎲 rolls a
 * new one.
 */
export const CLASSIC_MAP_SEED = 2;

/** A fresh map seed for 🎲 (small numbers, so a seed is easy to read out and share). */
export function rollMapSeed(random: () => number): number {
  return 1 + Math.floor(random() * 99_999);
}

/** A start-screen map change: a size, a type, or 🎲 a new map. */
export interface MapChoice {
  readonly size?: MapSize;
  readonly style?: MapStyle;
  readonly newSeed?: boolean;
}

/** Land per player at the start, if the land were shared evenly (shown on the start screen). */
export function landPerPlayer(landTiles: number, opponents: number): number {
  return Math.round(landTiles / (opponents + 1));
}
