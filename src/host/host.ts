/**
 * The host runs the simulation and turns commands into numbered turns (ARCHITECTURE.md
 * §5.6). The client only ever talks to this interface, so the simulation can later move
 * into a Web Worker (WorkerHost) or behind a server (NetworkHost) without touching the
 * renderer or UI.
 */
import type { Command } from "../sim/commands.ts";
import type { TickFrame } from "../sim/frame.ts";
import type { GameMap } from "../sim/map/gameMap.ts";
import type { GameSetup, PlayerId } from "../sim/world.ts";

export interface InitialState {
  readonly map: GameMap;
  /** Tile owners at tick 0 (a copy). */
  readonly owner: Uint16Array;
  /** The state at tick 0 (players, phase); its change list is empty. */
  readonly frame: TickFrame;
  /** The player this client controls. */
  readonly localPlayerId: PlayerId;
}

/** Timing information that isn't part of the game state (for the performance overlay). */
export interface FrameTiming {
  /** Wall-clock time the simulation took for this tick, in ms. */
  readonly tickMs: number;
}

export type FrameListener = (frame: TickFrame, timing: FrameTiming) => void;

export interface SimHost {
  start(setup: GameSetup): Promise<InitialState>;
  /** Queues a command from the local player for the next turn. */
  send(command: Command): void;
  onFrame(listener: FrameListener): () => void;
  /** Local games only. */
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Local games only: 1 = normal speed. */
  setSpeed(multiplier: number): void;
  /** Real time at which the latest frame was produced (performance.now() clock). */
  readonly lastFrameTime: number;
  readonly tickMs: number;
  dispose(): void;
}
