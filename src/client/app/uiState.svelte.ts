/**
 * The reactive state the Svelte UI reads. The session writes it at most once per tick
 * (ARCHITECTURE.md §6); components never change game state directly — they call the
 * session's actions.
 */
import type { AttackSnapshot, PlayerSnapshot } from "../../sim/frame.ts";
import type { Phase, PlayerId } from "../../sim/world.ts";
import { DEFAULT_ATTACK_PERCENT } from "./attackPercent.ts";

export type Screen = "loading" | "start" | "game";

class UiState {
  screen = $state<Screen>("loading");
  fatalError = $state<string | null>(null);
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
  }

  get me(): PlayerSnapshot | undefined {
    return this.players[this.localPlayerId - 1];
  }

  playerName(id: PlayerId): string {
    return id === 0 ? "Neutral land" : (this.players[id - 1]?.name ?? `Player ${id}`);
  }
}

export const ui = new UiState();
