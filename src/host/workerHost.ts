/**
 * WorkerHost (ARCHITECTURE.md §5.6, milestone 2.8): the simulation and its turn timer run
 * in a Web Worker, so a heavy tick never delays a frame on screen. The main thread keeps
 * the map (for drawing and the HUD), forwards commands, and turns the worker's slimmed
 * frames back into ordinary TickFrames — ship routes and walls are put back, and snapshots
 * of ships that didn't change are reused, as LocalHost's frames would.
 */
import type { Command, Turn } from "../sim/commands.ts";
import type { GameSetup, PlayerId } from "../sim/world.ts";
import type { FrameListener, InitialState, SimHost } from "./host.ts";
import { FrameRestorer, type FromWorker, type ToWorker } from "./workerProtocol.ts";

export interface WorkerHostOptions {
  localPlayerId: PlayerId;
  /** Online games (D-006): run the turns given to applyTurn instead of a timer. */
  turns?: boolean;
  /** Called if the simulation fails after it started. */
  onError?: (message: string) => void;
}

export class WorkerHost implements SimHost {
  private readonly worker: Worker;
  private readonly listeners = new Set<FrameListener>();
  private readonly localPlayerId: PlayerId;
  private readonly onError: (message: string) => void;
  private readonly turns: boolean;
  private ruleTickMs = 100;
  private speed = 1;
  private isPaused = false;
  private lastFrameAt = 0;
  private readonly restorer = new FrameRestorer();
  private starting: {
    resolve: (initial: InitialState) => void;
    reject: (error: Error) => void;
    setup: GameSetup;
  } | null = null;

  constructor(options: WorkerHostOptions) {
    this.localPlayerId = options.localPlayerId;
    this.onError = options.onError ?? ((message) => console.error(message));
    this.turns = options.turns ?? false;
    this.worker = new Worker(new URL("./simWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    this.worker.onerror = (event) => this.failed(event.message || "simulation worker failed");
  }

  get tickMs(): number {
    return this.ruleTickMs / this.speed;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get lastFrameTime(): number {
    return this.lastFrameAt;
  }

  start(setup: GameSetup): Promise<InitialState> {
    if (this.starting) throw new Error("WorkerHost.start() called twice");
    this.ruleTickMs = setup.rules?.tickMs ?? 100;
    const { map } = setup;
    // The worker gets copies of the map's arrays; the main thread keeps its map (its
    // derived sea data is cached against that object).
    this.post({
      type: "start",
      seed: setup.seed,
      players: setup.players,
      rules: setup.rules,
      localPlayerId: this.localPlayerId,
      width: map.width,
      height: map.height,
      terrain: map.terrain,
      relief: map.relief,
      turns: this.turns,
    });
    return new Promise((resolve, reject) => {
      this.starting = { resolve, reject, setup };
    });
  }

  send(command: Command): void {
    this.post({ type: "send", playerId: null, command });
  }

  /** Online games: the next turn from the server (after start() resolved). */
  applyTurn(turn: Turn): void {
    this.post({ type: "turn", turn });
  }

  /** Development checks only (the debug hook): a command as if another player sent it. */
  sendAs(playerId: PlayerId, command: Command): void {
    this.post({ type: "send", playerId, command });
  }

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pause(): void {
    this.isPaused = true;
    this.post({ type: "pause" });
  }

  resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.lastFrameAt = performance.now();
    this.post({ type: "resume" });
  }

  setSpeed(multiplier: number): void {
    if (!(multiplier > 0)) throw new RangeError(`Invalid speed ${multiplier}`);
    this.speed = multiplier;
    this.post({ type: "speed", multiplier });
  }

  dispose(): void {
    this.listeners.clear();
    this.worker.terminate();
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  private receive(message: FromWorker): void {
    if (message.type === "error") {
      this.failed(message.message);
      return;
    }
    const frame = this.restorer.restore(message.frame);
    this.lastFrameAt = performance.now();
    if (message.type === "started") {
      const starting = this.starting;
      if (!starting) return;
      starting.resolve({
        map: starting.setup.map,
        owner: message.owner,
        frame,
        localPlayerId: this.localPlayerId,
      });
      return;
    }
    // Frames already in flight when the game was paused are still shown.
    for (const listener of this.listeners) listener(frame, { tickMs: message.tickMs });
  }

  private failed(message: string): void {
    if (this.starting && this.lastFrameAt === 0) this.starting.reject(new Error(message));
    else this.onError(message);
  }
}
