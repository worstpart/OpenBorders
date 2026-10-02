/**
 * The reactive state the Svelte UI reads. The session writes it at most once per tick
 * (ARCHITECTURE.md §6); components never change game state directly — they call the
 * session's actions.
 */
import type { AttackSnapshot, PlayerSnapshot } from "../../sim/frame.ts";
import { DEFAULT_RULES } from "../../sim/rules.ts";
import type { Phase, PlayerId } from "../../sim/world.ts";
import { DEFAULT_ATTACK_PERCENT } from "./attackPercent.ts";
import type { HintId } from "./hints.ts";
import type { PreviewContext } from "./preview.ts";
import { DEFAULT_OPPONENTS, type MapSize } from "./setup.ts";
import type { Toast } from "./toasts.ts";

export type Screen = "loading" | "start" | "game";

/** Game speeds offered in the pause menu (solo games only). */
export const GAME_SPEEDS = [1, 2, 4] as const;

/** The open menu, if any: the pause menu, or the right-click menu for a tile. */
export type Menu =
  | { readonly kind: "pause" }
  | {
      readonly kind: "context";
      /** Where it opened, in CSS pixels. */
      readonly x: number;
      readonly y: number;
      readonly tile: number;
      readonly owner: PlayerId;
    };

/** The land tile under the mouse (null: none, or the card is hidden). */
export interface HoverInfo {
  readonly tile: number;
  readonly owner: PlayerId;
  /** 1 plains · 2 highland · 3 mountain. */
  readonly terrain: number;
  readonly x: number;
  readonly y: number;
}

class UiState {
  screen = $state<Screen>("loading");
  fatalError = $state<string | null>(null);
  /** Start-screen choices (kept across games; pure UI choices like the attack %). */
  opponents = $state(DEFAULT_OPPONENTS);
  mapSize = $state<MapSize>("normal");
  phase = $state<Phase>("spawn");
  tick = $state(0);
  playStartTick = $state(-1);
  localPlayerId = $state<PlayerId>(0);
  /** Total land tiles on the map (for land %). */
  landTiles = $state(1);
  /** Colors by player id. */
  colors = $state.raw<readonly string[]>([]);
  players = $state.raw<readonly PlayerSnapshot[]>([]);
  attacks = $state.raw<readonly AttackSnapshot[]>([]);
  /** Share of home troops a click sends (client-side choice; sent with each command). */
  attackPercent = $state(DEFAULT_ATTACK_PERCENT);
  winner = $state<PlayerId | null>(null);
  gameOverReason = $state<"landShare" | "lastStanding" | "noneLeft" | null>(null);
  /** Who eliminated the local player (null: nobody / not eliminated). */
  eliminatedBy = $state<PlayerId | null>(null);
  /** The local player closed the "you were eliminated" card to keep watching. */
  spectating = $state(false);
  /** Biggest size each attack had (attack id → troops), for the chips' shrinking bars. */
  attackPeak = $state.raw<ReadonlyMap<number, number>>(new Map());
  menu = $state.raw<Menu | null>(null);
  paused = $state(false);
  /** Game speed multiplier (solo games). */
  speed = $state(1);
  hover = $state.raw<HoverInfo | null>(null);
  toasts = $state.raw<readonly Toast[]>([]);
  hint = $state<HintId | null>(null);

  /** Back to a clean slate for a new game. */
  reset(): void {
    this.phase = "spawn";
    this.tick = 0;
    this.playStartTick = -1;
    this.players = [];
    this.attacks = [];
    this.winner = null;
    this.gameOverReason = null;
    this.eliminatedBy = null;
    this.spectating = false;
    this.attackPeak = new Map();
    this.menu = null;
    this.paused = false;
    this.speed = 1;
    this.hover = null;
    this.toasts = [];
    this.hint = null;
  }

  get me(): PlayerSnapshot | undefined {
    return this.players[this.localPlayerId - 1];
  }

  /** What the battle preview needs (Phase 1 always plays with the default rules). */
  get previewContext(): PreviewContext {
    return {
      rules: DEFAULT_RULES,
      phase: this.phase,
      tick: this.tick,
      playStartTick: this.playStartTick,
      me: this.me,
      players: this.players,
    };
  }

  colorOf(id: PlayerId): string {
    return id === 0 ? "#9aa5b4" : (this.colors[id] ?? "#888");
  }

  playerName(id: PlayerId): string {
    return id === 0 ? "Neutral land" : (this.players[id - 1]?.name ?? `Player ${id}`);
  }
}

export const ui = new UiState();
