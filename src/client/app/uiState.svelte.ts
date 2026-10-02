/**
 * The reactive state the Svelte UI reads. The session writes it at most once per tick
 * (ARCHITECTURE.md §6); components never change game state directly — they call the
 * session's actions.
 */
import type { PlayerSnapshot } from "../../sim/frame.ts";
import type { Phase, PlayerId } from "../../sim/world.ts";

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

  get me(): PlayerSnapshot | undefined {
    return this.players[this.localPlayerId - 1];
  }
}

export const ui = new UiState();
