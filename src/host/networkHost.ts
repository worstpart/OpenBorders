/**
 * NetworkHost (Phase 3, D-006): an online game. The simulation still runs here — in the
 * worker, like a solo game — but its clock is the server: it runs exactly the turns the
 * server sends, in order, and the local player's commands go to the server instead of
 * straight into the next tick. Every turn carries the server's state hash; a tick whose
 * hash differs means this client has drifted (3.5 repairs that with a snapshot).
 *
 * The socket itself lives with the client (client/app/online.ts): this class only needs a
 * way to send a command, and is handed the turns.
 */
import type { Command, StampedCommand } from "../sim/commands.ts";
import type { GameSetup, PlayerId } from "../sim/world.ts";
import type { FrameListener, InitialState, SimHost } from "./host.ts";
import { LocalHost } from "./localHost.ts";
import { WorkerHost } from "./workerHost.ts";

export interface ServerTurn {
  readonly tick: number;
  readonly commands: readonly StampedCommand[];
  readonly hash: number;
}

export interface NetworkHostOptions {
  readonly localPlayerId: PlayerId;
  /** Sends the local player's command to the server. */
  readonly sendCommand: (command: Command) => void;
  /** This client's state differs from the server's after `tick` (reported once). */
  readonly onDesync?: (tick: number) => void;
  readonly onError?: (message: string) => void;
}

export class NetworkHost implements SimHost {
  private readonly inner: WorkerHost | LocalHost;
  private readonly options: NetworkHostOptions;
  private started = false;
  private waiting: ServerTurn[] = [];
  /** The server's hash for each tick sent to the simulation but not checked yet. */
  private readonly expected = new Map<number, number>();
  private desynced = false;
  private ruleTickMs = 100;

  constructor(options: NetworkHostOptions) {
    this.options = options;
    this.inner =
      typeof Worker === "undefined"
        ? new LocalHost({ localPlayerId: options.localPlayerId, clock: "manual" })
        : new WorkerHost({
            localPlayerId: options.localPlayerId,
            turns: true,
            ...(options.onError ? { onError: options.onError } : {}),
          });
    this.inner.onFrame((frame) => {
      const hash = this.expected.get(frame.tick);
      if (hash === undefined) return;
      this.expected.delete(frame.tick);
      if (hash !== frame.hash && !this.desynced) {
        this.desynced = true;
        this.options.onDesync?.(frame.tick);
      }
    });
  }

  get tickMs(): number {
    return this.ruleTickMs;
  }

  /** Online games can't be paused or sped up: the server keeps time for everyone. */
  get paused(): boolean {
    return false;
  }

  get lastFrameTime(): number {
    return this.inner.lastFrameTime;
  }

  /** Whether this client has drifted from the server (since the game started). */
  get outOfSync(): boolean {
    return this.desynced;
  }

  async start(setup: GameSetup): Promise<InitialState> {
    this.ruleTickMs = setup.rules?.tickMs ?? 100;
    const initial = await this.inner.start(setup);
    this.started = true;
    // Turns that arrived while the map was being prepared, in order.
    const waiting = this.waiting;
    this.waiting = [];
    for (const turn of waiting) this.run(turn);
    return initial;
  }

  /** The next turn from the server. */
  receiveTurn(turn: ServerTurn): void {
    if (this.started) this.run(turn);
    else this.waiting.push(turn);
  }

  send(command: Command): void {
    this.options.sendCommand(command);
  }

  onFrame(listener: FrameListener): () => void {
    return this.inner.onFrame(listener);
  }

  pause(): void {}

  resume(): void {}

  setSpeed(): void {}

  /** Development checks only: online, a command as another player would be cheating. */
  sendAs(): void {
    throw new Error("sendAs() isn't available in online games");
  }

  dispose(): void {
    this.inner.dispose();
    this.waiting = [];
    this.expected.clear();
  }

  private run(turn: ServerTurn): void {
    this.expected.set(turn.tick, turn.hash);
    this.inner.applyTurn({ tick: turn.tick, commands: turn.commands });
  }
}
