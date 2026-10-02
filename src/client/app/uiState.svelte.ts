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

  get me(): PlayerSnapshot | undefined {
    return this.players[this.localPlayerId - 1];
  }

  playerName(id: PlayerId): string {
    return id === 0 ? "Neutral land" : (this.players[id - 1]?.name ?? `Player ${id}`);
  }
}

export const ui = new UiState();
